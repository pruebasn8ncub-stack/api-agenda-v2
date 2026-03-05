-- ═══════════════════════════════════════════════════════════════════
--  Api-Agenda v2 — Database Migration
--  Run this against your Supabase instance's SQL Editor
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. Clinic Settings (configurable parameters) ────────────────────

CREATE TABLE IF NOT EXISTS clinic_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  value JSONB NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Seed default values
INSERT INTO clinic_settings (key, value, description) VALUES
  ('slot_interval_minutes', '15', 'Granularidad de slots en minutos'),
  ('timezone', '"America/Santiago"', 'Timezone IANA de la clínica'),
  ('max_lookahead_days', '3', 'Días de búsqueda proactiva (smart availability)'),
  ('working_hours_start', '"08:00"', 'Hora de inicio de atención'),
  ('working_hours_end', '"20:00"', 'Hora de fin de atención')
ON CONFLICT (key) DO NOTHING;


-- ── 2. Performance Indexes ─────────────────────────────────────────

-- Appointment allocations: critical for overlap queries
CREATE INDEX IF NOT EXISTS idx_appointment_allocations_time_range
  ON appointment_allocations (starts_at, ends_at);

CREATE INDEX IF NOT EXISTS idx_appointment_allocations_professional
  ON appointment_allocations (professional_id, starts_at, ends_at);

CREATE INDEX IF NOT EXISTS idx_appointment_allocations_resource
  ON appointment_allocations (physical_resource_id, starts_at, ends_at);

-- Schedule exceptions: time range queries
CREATE INDEX IF NOT EXISTS idx_schedule_exceptions_time_range
  ON schedule_exceptions (starts_at, ends_at);

-- Professional schedules: day lookup
CREATE INDEX IF NOT EXISTS idx_professional_schedules_day
  ON professional_schedules (professional_id, day_of_week);

-- Appointments: status + time filtering
CREATE INDEX IF NOT EXISTS idx_appointments_status_starts
  ON appointments (status, starts_at);


-- ── 3. Verify Foreign Keys ─────────────────────────────────────────

-- service_phases → services (sub_service)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'service_phases_sub_service_id_fkey'
  ) THEN
    ALTER TABLE service_phases
    ADD CONSTRAINT service_phases_sub_service_id_fkey
    FOREIGN KEY (sub_service_id) REFERENCES services(id);
  END IF;
END $$;
