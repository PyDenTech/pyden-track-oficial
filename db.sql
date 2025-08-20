-- =======================
--  SCHEMA – PyDen Track
--  (idempotente)
-- =======================

-- === USERS ===
CREATE TABLE IF NOT EXISTS users (
  id                   SERIAL PRIMARY KEY,
  full_name            TEXT,
  name                 TEXT,
  email                TEXT NOT NULL UNIQUE,
  password             TEXT,
  role                 TEXT DEFAULT 'USER',    -- 'ADMIN' | 'CLIENTE' | 'USER'
  active               BOOLEAN NOT NULL DEFAULT TRUE,

  -- preferências/limites
  maps_allowed         JSONB DEFAULT '[]'::jsonb,
  vehicle_limit        INTEGER DEFAULT 0,
  expires_at           TIMESTAMPTZ,

  -- extras
  document             TEXT,
  company              TEXT,
  notes                TEXT,

  -- recuperação de senha
  reset_code           TEXT,
  reset_code_expires   TIMESTAMPTZ,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ
);

-- busca por email (case-insensitive)
CREATE INDEX IF NOT EXISTS idx_users_email_ci ON users (lower(email));

-- === DEVICES ===
CREATE TABLE IF NOT EXISTS devices (
  id               SERIAL PRIMARY KEY,
  name             TEXT NOT NULL,
  protocol         TEXT,                 -- 'J16' | 'GT06' | 'GENERIC' etc.
  device_group     TEXT,                 -- agrupamento por nome
  imei             TEXT NOT NULL UNIQUE, -- 15 dígitos normalmente
  msisdn           TEXT,                 -- número do chip
  carrier          TEXT,

  status           TEXT,                 -- 'ONLINE' | 'OFFLINE' | etc.
  last_seen        TIMESTAMPTZ,
  notes            TEXT,

  -- conectividade/config
  apn              TEXT,
  apn_user         TEXT,
  apn_pass         TEXT,
  server_type      TEXT,                 -- 'dns' | 'ip'
  server_host      TEXT,
  server_port      INTEGER,
  tz               INTEGER,              -- -12..14 (horas)

  -- específicos J16 (opcionais)
  j16_timer_on     INTEGER,
  j16_timer_off    INTEGER,
  j16_angle        INTEGER,
  j16_acc_virtual  TEXT,

  -- snapshot (últimos dados p/ mapa)
  last_lat         DOUBLE PRECISION,
  last_lng         DOUBLE PRECISION,
  last_speed_kmh   REAL,
  last_course_deg  REAL,
  last_fix_time    TIMESTAMPTZ,

  -- novos indicadores usados no front
  ignition         BOOLEAN,              -- estado atual (última leitura)
  gps_signal       BOOLEAN,              -- heurística de sinal (última leitura)
  last_altitude_m  REAL,
  last_battery_v   REAL,

  -- dono
  owner_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ
);

-- Garantir existência das colunas caso a tabela seja antiga
ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS ignition BOOLEAN,
  ADD COLUMN IF NOT EXISTS gps_signal BOOLEAN,
  ADD COLUMN IF NOT EXISTS last_altitude_m REAL,
  ADD COLUMN IF NOT EXISTS last_battery_v REAL;

-- Índices úteis
CREATE INDEX IF NOT EXISTS idx_devices_owner ON devices(owner_id);
CREATE INDEX IF NOT EXISTS idx_devices_group ON devices(device_group);
CREATE INDEX IF NOT EXISTS idx_devices_imei  ON devices(imei);

-- === POSITIONS (histórico) ===
CREATE TABLE IF NOT EXISTS positions (
  id            BIGSERIAL PRIMARY KEY,
  device_id     INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  fix_time      TIMESTAMPTZ NOT NULL,  -- quando o GPS fixou
  lat           DOUBLE PRECISION NOT NULL,
  lng           DOUBLE PRECISION NOT NULL,
  speed_kmh     REAL,
  course_deg    REAL,
  altitude_m    REAL,
  satellites    SMALLINT,
  hdop          REAL,
  ignition      BOOLEAN,
  battery_v     REAL,
  raw_payload   BYTEA,                 -- opcional: payload bruto
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices de consulta (timeline, por device)
CREATE INDEX IF NOT EXISTS idx_positions_device_time ON positions(device_id, fix_time DESC);
CREATE INDEX IF NOT EXISTS idx_positions_time        ON positions(fix_time DESC);

-- ============================
-- TRIGGER: atualizar snapshot
-- ============================

-- Heurística simples para gps_signal:
--  - TRUE se satellites >= 3, ou (hdop <= 3)
--  - FALSE se satellites é 0/1/2, ou (hdop > 8)
--  - NULL caso indeterminado
CREATE OR REPLACE FUNCTION _gps_signal_from_quality(_sat SMALLINT, _hdop REAL)
RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF _sat IS NOT NULL THEN
    IF _sat >= 3 THEN RETURN TRUE; END IF;
    IF _sat <= 2 THEN RETURN FALSE; END IF;
  END IF;
  IF _hdop IS NOT NULL THEN
    IF _hdop <= 3 THEN RETURN TRUE; END IF;
    IF _hdop > 8 THEN RETURN FALSE; END IF;
  END IF;
  RETURN NULL;
END$$;

-- Atualiza o snapshot em devices após inserir uma posição
CREATE OR REPLACE FUNCTION trg_positions_after_ins()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_gps BOOLEAN;
BEGIN
  v_gps := _gps_signal_from_quality(NEW.satellites, NEW.hdop);

  UPDATE devices d
     SET last_lat        = NEW.lat,
         last_lng        = NEW.lng,
         last_speed_kmh  = NEW.speed_kmh,
         last_course_deg = NEW.course_deg,
         last_fix_time   = NEW.fix_time,
         last_altitude_m = NEW.altitude_m,
         last_battery_v  = NEW.battery_v,
         ignition        = NEW.ignition,
         gps_signal      = COALESCE(v_gps, d.gps_signal),
         status          = 'ONLINE',
         last_seen       = now(),
         updated_at      = now()
   WHERE d.id = NEW.device_id;

  RETURN NEW;
END$$;

DROP TRIGGER IF EXISTS positions_after_ins ON positions;
CREATE TRIGGER positions_after_ins
AFTER INSERT ON positions
FOR EACH ROW
EXECUTE FUNCTION trg_positions_after_ins();

-- (Opcional) Função para marcar OFFLINE dispositivos sem contato há X minutos.
-- Você pode agendar isso via cron/pgagent, caso queira.
CREATE OR REPLACE FUNCTION mark_devices_offline_if_stale(_minutes INTEGER DEFAULT 15)
RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE devices
     SET status = 'OFFLINE',
         updated_at = now()
   WHERE last_seen IS NOT NULL
     AND last_seen < now() - make_interval(mins => _minutes)
     AND COALESCE(status, '') <> 'OFFLINE';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END$$;

-- ============================
-- VIEWS de compatibilidade
-- ============================
CREATE OR REPLACE VIEW objects AS
SELECT
  d.id,
  d.name,
  d.last_lat AS lat,
  d.last_lng AS lng
FROM devices d;

CREATE OR REPLACE VIEW device_groups_agg AS
SELECT
  COALESCE(NULLIF(trim(device_group), ''), 'Desagrupado') AS name,
  COUNT(*)::int AS total
FROM devices
GROUP BY 1
ORDER BY 1;

PGSSLMODE=require psql \
  -h pyden-track.cjucwyoced9l.sa-east-1.rds.amazonaws.com \
  -p 5432 \
  -U postgres \
  -d pyden-track-oficial
