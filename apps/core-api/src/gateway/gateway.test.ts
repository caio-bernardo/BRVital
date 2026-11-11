
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendFhir } from './fhir.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('fronteira HTTP do gateway sintético', () => {
  it('recusa produção e destinos externos antes de qualquer envio', async () => {
    vi.stubEnv('APP_MODE', 'synthetic');
    vi.stubEnv('NODE_ENV', 'production');
    await expect(sendFhir('http://localhost:8080/fhir', {}, 100)).rejects.toThrow('sintético');
    vi.stubEnv('NODE_ENV', 'test');
    for (const url of ['https://example.org/fhir', 'http://localhost:8080/fhir@evil.org', 'http://localhost:8080/fhir?destino=externo', 'http://usuario:senha@localhost:8080/fhir']) {
      await expect(sendFhir(url, {}, 100)).rejects.toThrow('local');
    }
  });

  it('não segue redirecionamento do HAPI e não expõe o corpo remoto no erro', async () => {
    vi.stubEnv('APP_MODE', 'synthetic');
    vi.stubEnv('NODE_ENV', 'test');
    const fetch = vi.fn().mockResolvedValue(new Response('PII que não deve aparecer no erro', {
      status: 302, headers: { location: 'https://example.org/dados' },
    }));
    vi.stubGlobal('fetch', fetch);
    await expect(sendFhir('http://localhost:8080/fhir', {}, 1000)).rejects.toThrow('FHIR_HTTP_302');
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]![1].redirect).toBe('manual');
  });
});
