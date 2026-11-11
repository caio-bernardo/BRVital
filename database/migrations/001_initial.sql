CREATE EXTENSION IF NOT EXISTS postgis;
CREATE SCHEMA identity;
CREATE SCHEMA clinical;
CREATE SCHEMA network;
CREATE SCHEMA ops;

-- O migrador é o proprietário; a aplicação nunca recebe associação a essa role.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'brvital_app') THEN
    CREATE ROLE brvital_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END $$;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

CREATE TABLE identity.patient (
  id uuid PRIMARY KEY,
  phone_hmac bytea UNIQUE NOT NULL,
  phone_enc bytea,
  full_name_enc bytea, cpf_enc bytea, cpf_hmac bytea UNIQUE, cns_enc bytea, birth_date_enc bytea,
  created_at timestamptz NOT NULL DEFAULT now(), erased_at timestamptz
);
CREATE TABLE identity.consent (
  id uuid PRIMARY KEY,
  patient_id uuid NOT NULL REFERENCES identity.patient,
  purpose text NOT NULL CHECK (purpose IN ('triage','share_with_facility','research')),
  policy_version text NOT NULL,
  granted_at timestamptz NOT NULL, revoked_at timestamptz
);
CREATE UNIQUE INDEX one_active_consent ON identity.consent(patient_id, purpose) WHERE revoked_at IS NULL;
CREATE TABLE identity.otp_challenge (
  id uuid PRIMARY KEY,
  phone_hmac bytea NOT NULL,
  phone_enc bytea NOT NULL,
  code_hash bytea NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts int NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_frequency ON identity.otp_challenge(phone_hmac, created_at DESC);

CREATE TABLE network.facility (
  id uuid PRIMARY KEY, cnes_code text UNIQUE, name text NOT NULL,
  org_name text NOT NULL, cnpj text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('public','philanthropic','private')),
  address jsonb NOT NULL, geo geography(Point,4326) NOT NULL,
  accepts_remote_tickets boolean NOT NULL DEFAULT false,
  connector_kind text NOT NULL CHECK (connector_kind IN ('fhir_r4','hl7v2')),
  connector_base_url text NOT NULL, connector_secret_ref text NOT NULL,
  queue_size int, avg_wait_min int, status_updated_at timestamptz,
  ticket_window_min int NOT NULL DEFAULT 30 CHECK (ticket_window_min > 0),
  synthetic boolean NOT NULL DEFAULT true
);
CREATE INDEX facility_geo ON network.facility USING gist(geo);
CREATE TABLE network.facility_specialty (
  facility_id uuid REFERENCES network.facility, specialty_code text,
  open_hours jsonb NOT NULL,
  PRIMARY KEY (facility_id, specialty_code)
);
CREATE TABLE clinical.triage_session (
  id uuid PRIMARY KEY, patient_id uuid NOT NULL REFERENCES identity.patient,
  started_at timestamptz NOT NULL DEFAULT now(), status text NOT NULL,
  answers jsonb NOT NULL, coarse_geo geography(Point,4326), recommendations jsonb
);
CREATE TABLE clinical.triage_report (
  id uuid PRIMARY KEY,
  session_id uuid UNIQUE NOT NULL REFERENCES clinical.triage_session,
  urgency_level smallint NOT NULL CHECK (urgency_level BETWEEN 1 AND 5),
  specialties text[] NOT NULL, red_flags text[] NOT NULL DEFAULT '{}',
  explanation jsonb NOT NULL CHECK (jsonb_typeof(explanation) = 'array' AND NOT jsonb_path_exists(explanation, '$[*] ? (@.type() != "string")')),
  ruleset_version text NOT NULL,
  content_hash bytea NOT NULL CHECK (octet_length(content_hash) = 32),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ops.ticket (
  id uuid PRIMARY KEY,
  report_id uuid NOT NULL REFERENCES clinical.triage_report,
  patient_id uuid NOT NULL REFERENCES identity.patient,
  facility_id uuid NOT NULL REFERENCES network.facility,
  status text NOT NULL CHECK (status IN ('requested','sent','active','rejected','failed','cancelled','expired','attended','no_show')),
  external_ref text, display_code text, priority smallint NOT NULL CHECK (priority BETWEEN 1 AND 5),
  idempotency_key text UNIQUE NOT NULL,
  issued_at timestamptz, valid_until timestamptz,
  failure_reason text,
  cancellation_pending boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX one_active_ticket ON ops.ticket(patient_id) WHERE status IN ('requested','sent','active');
CREATE TABLE ops.ticket_event (
  id bigserial PRIMARY KEY, ticket_id uuid NOT NULL REFERENCES ops.ticket,
  type text NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ops.outbox (
  id bigserial PRIMARY KEY, aggregate_id uuid NOT NULL, type text NOT NULL,
  payload jsonb NOT NULL, attempts int NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz
);
CREATE INDEX outbox_pending ON ops.outbox(next_attempt_at, id) WHERE published_at IS NULL;
CREATE TABLE ops.outcome (
  ticket_id uuid PRIMARY KEY REFERENCES ops.ticket,
  facility_urgency_level smallint CHECK (facility_urgency_level BETWEEN 1 AND 5),
  arrived_at timestamptz, triaged_at timestamptz, disposition text
);
CREATE TABLE ops.audit_log (
  id bigserial PRIMARY KEY, actor text NOT NULL, action text NOT NULL, resource text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ops.privacy_request (
  id uuid PRIMARY KEY, patient_id uuid NOT NULL REFERENCES identity.patient,
  kind text NOT NULL CHECK (kind IN ('export','erase')),
  status text NOT NULL DEFAULT 'requested' CHECK (status = 'requested'),
  received_at timestamptz NOT NULL DEFAULT now(), due_at timestamptz NOT NULL
);

CREATE FUNCTION ops.forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Registro imutável: %', TG_TABLE_NAME USING ERRCODE = '42501';
END $$;
CREATE TRIGGER immutable_report BEFORE UPDATE OR DELETE OR TRUNCATE ON clinical.triage_report
  FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();
CREATE TRIGGER append_only_ticket_event BEFORE UPDATE OR DELETE OR TRUNCATE ON ops.ticket_event
  FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();
CREATE TRIGGER append_only_audit_log BEFORE UPDATE OR DELETE OR TRUNCATE ON ops.audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION ops.forbid_mutation();

GRANT USAGE ON SCHEMA identity, clinical, network, ops TO brvital_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA identity TO brvital_app;
GRANT SELECT ON ALL TABLES IN SCHEMA network TO brvital_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON clinical.triage_session TO brvital_app;
GRANT SELECT, INSERT ON clinical.triage_report, ops.ticket_event, ops.audit_log TO brvital_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ops.ticket, ops.outbox, ops.outcome, ops.privacy_request TO brvital_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ops TO brvital_app;
REVOKE ALL ON FUNCTION ops.forbid_mutation() FROM PUBLIC;
