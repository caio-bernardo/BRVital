import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { Recommendation } from '@brvital/contracts';
import { Database, audit } from '../database.js';
import { TriageService } from '../triage/triage.service.js';

@Injectable()
export class NetworkService {
  constructor(@Inject(Database) private readonly db: Database, @Inject(TriageService) private readonly triage: TriageService) {}
  async recommend(patientId: string, sessionId: string, location: { lat?: number; lng?: number; area?: string }): Promise<Recommendation[]> {
    const report = await this.triage.report(patientId, sessionId);
    if (report.redFlags.length || report.urgencyLevel === 1) throw new ForbiddenException('Sinal de emergência. Ligue 192; nenhuma unidade será recomendada.');
    let { lat, lng } = location;
    if (lat === undefined || lng === undefined) {
      const area = location.area?.normalize('NFD').replace(/[\u0300-\u036f\s-]/g, '').toLowerCase();
      if (!area || !['centro', 'se', '01001000'].includes(area)) throw new BadRequestException('Na demonstração, informe Centro, Sé ou CEP 01001-000, em São Paulo; ou use coordenadas.');
      // shortcut: catálogo local só cobre o centro de São Paulo; integrar geocodificação antes de ampliar a cobertura.
      lat = -23.5505; lng = -46.6333;
    }
    const latitude = Math.round(lat * 100) / 100, longitude = Math.round(lng * 100) / 100;
    const candidates = await this.db.pool.query(`SELECT f.*, ST_Y(f.geo::geometry) AS lat, ST_X(f.geo::geometry) AS lng,
      ST_Distance(f.geo,ST_SetSRID(ST_MakePoint($1,$2),4326)::geography)/1000 AS distance,
      ARRAY(SELECT fs.specialty_code FROM network.facility_specialty fs WHERE fs.facility_id=f.id) AS specialties
      FROM network.facility f WHERE f.accepts_remote_tickets AND f.synthetic AND f.connector_kind='fhir_r4'
      AND ST_DWithin(f.geo,ST_SetSRID(ST_MakePoint($1,$2),4326)::geography,50000)
      AND EXISTS(SELECT 1 FROM network.facility_specialty fs WHERE fs.facility_id=f.id AND fs.specialty_code=ANY($3::text[])
        AND fs.open_hours @> '{"alwaysOpen":true}'::jsonb)
      ORDER BY distance LIMIT 10`, [longitude, latitude, report.specialties]);
    const recommendations: Recommendation[] = [];
    for (const row of candidates.rows) {
      if (!['http://localhost:8080/fhir', 'http://hapi:8080/fhir'].includes(row.connector_base_url)) continue;
      try {
        const response = await fetch(`${row.connector_base_url}/metadata`, { signal: AbortSignal.timeout(1500), redirect: 'error', headers: { Accept: 'application/fhir+json' } });
        if (!response.ok) continue;
      } catch { continue; }
      const fresh = row.status_updated_at && Date.now() - row.status_updated_at.getTime() < 60000;
      recommendations.push({ facilityId: row.id, name: row.name, address: `${row.address.street}, ${row.address.city} / ${row.address.state}`,
        specialties: row.specialties, distanceKm: Math.round(Number(row.distance) * 10) / 10,
        travelMinutes: null, waitMinutes: fresh ? row.avg_wait_min : null, statusUpdatedAt: fresh ? row.status_updated_at.toISOString() : null,
        latitude: row.lat, longitude: row.lng });
    }
    await this.db.transaction(async client => {
      await client.query(`UPDATE clinical.triage_session SET coarse_geo=ST_SetSRID(ST_MakePoint($2,$3),4326)::geography,recommendations=$4 WHERE id=$1 AND patient_id=$5`, [sessionId, longitude, latitude, JSON.stringify(recommendations), patientId]);
      await audit(client, `patient:${patientId}`, 'network.recommendations', `session:${sessionId}`);
    });
    return recommendations;
  }
}
