-- APeX · Combined Migration
-- Paste this entire file in Supabase Dashboard → SQL Editor → New query, then click Run.
-- Then run: npm run seed   (from the mobile/ directory)
-- ─────────────────────────────────────────────────────────────────────────────

-- APeX Â· Initial Schema
-- Run this in the Supabase SQL Editor (Dashboard â†’ SQL Editor â†’ New query)
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

-- â”€â”€ Teams â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE TABLE public.teams (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.team_settings (
  team_id                UUID PRIMARY KEY REFERENCES public.teams(id) ON DELETE CASCADE,
  readiness_threshold    INT  NOT NULL DEFAULT 75,
  max_lr_imbalance       INT  NOT NULL DEFAULT 15,
  required_tests_per_day INT  NOT NULL DEFAULT 3,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.required_tests (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id    UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NOT NULL DEFAULT 0
);

-- â”€â”€ Users â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

-- One row per Supabase auth user; id mirrors auth.users.id
CREATE TABLE public.profiles (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('athlete', 'manager')),
  team_id    UUID REFERENCES public.teams(id),
  full_name  TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Physical attributes â€” only for athletes
CREATE TABLE public.athlete_profiles (
  id            UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  height_cm     INT,
  weight_kg     INT,
  position      TEXT,
  date_of_birth DATE
);

-- â”€â”€ Sessions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE TABLE public.sessions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  exercise_type      TEXT NOT NULL CHECK (exercise_type IN ('squat','deadlift','jump','pullup')),
  recorded_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rep_count          INT NOT NULL DEFAULT 0,
  readiness_score    INT,               -- 0â€“100, computed client-side
  video_storage_path TEXT,              -- Supabase Storage key (future)
  analysis_json      JSONB,             -- full Assessment object for audit/replay
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Key-value aggregate metrics extracted from analysis_json for fast queries
CREATE TABLE public.session_metrics (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  metric_key TEXT  NOT NULL,
  value      FLOAT NOT NULL
  -- metric_key examples: squat_rom_deg, jump_rom_deg, flight_time_s,
  --                       lr_imbalance_pct, squat_reps, jump_reps
);

-- â”€â”€ Notifications â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE TABLE public.notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id    UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  athlete_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  session_id UUID REFERENCES public.sessions(id) ON DELETE SET NULL,
  message    TEXT NOT NULL,
  severity   TEXT NOT NULL CHECK (severity IN ('info','warning','critical')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tracks which managers have dismissed which notifications
CREATE TABLE public.notification_reads (
  manager_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  notification_id UUID NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  read_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (manager_id, notification_id)
);

-- â”€â”€ Indexes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE INDEX idx_sessions_athlete_time ON public.sessions (athlete_id, recorded_at DESC);
CREATE INDEX idx_sessions_exercise     ON public.sessions (exercise_type);
CREATE INDEX idx_notif_team_time       ON public.notifications (team_id, created_at DESC);
CREATE INDEX idx_metrics_session       ON public.session_metrics (session_id, metric_key);
CREATE INDEX idx_profiles_team_role    ON public.profiles (team_id, role);

-- â”€â”€ Trigger: auto-update team_settings.updated_at â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_team_settings_updated_at
  BEFORE UPDATE ON public.team_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- â”€â”€ Helper: caller's team_id â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE OR REPLACE FUNCTION public.my_team_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT team_id FROM public.profiles WHERE id = auth.uid()
$$;

-- â”€â”€ Row Level Security â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

ALTER TABLE public.teams              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_settings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.required_tests     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.athlete_profiles   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_metrics    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_reads ENABLE ROW LEVEL SECURITY;

-- teams: members can read their own team
CREATE POLICY "read own team" ON public.teams
  FOR SELECT USING (id = public.my_team_id());

-- team_settings: team members can read; only managers update
CREATE POLICY "read team settings" ON public.team_settings
  FOR SELECT USING (team_id = public.my_team_id());

CREATE POLICY "manager updates team settings" ON public.team_settings
  FOR UPDATE USING (
    team_id = public.my_team_id()
    AND (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'manager'
  );

-- required_tests: all team members read; managers write
CREATE POLICY "read required tests" ON public.required_tests
  FOR SELECT USING (team_id = public.my_team_id());

CREATE POLICY "manager manages required tests" ON public.required_tests
  FOR ALL USING (
    team_id = public.my_team_id()
    AND (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'manager'
  ) WITH CHECK (team_id = public.my_team_id());

-- profiles: read all same-team; update own
CREATE POLICY "read team profiles" ON public.profiles
  FOR SELECT USING (team_id = public.my_team_id());

CREATE POLICY "insert own profile" ON public.profiles
  FOR INSERT WITH CHECK (id = auth.uid());

CREATE POLICY "update own profile" ON public.profiles
  FOR UPDATE USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- athlete_profiles: athletes own; managers in same team can read
CREATE POLICY "athlete manages own profile" ON public.athlete_profiles
  FOR ALL USING (id = auth.uid()) WITH CHECK (id = auth.uid());

CREATE POLICY "manager reads team athlete profiles" ON public.athlete_profiles
  FOR SELECT USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'manager'
    AND (SELECT team_id FROM public.profiles WHERE id = athlete_profiles.id)
        = public.my_team_id()
  );

-- sessions: athletes own; managers can read team's
CREATE POLICY "athlete owns sessions" ON public.sessions
  FOR ALL USING (athlete_id = auth.uid())
  WITH CHECK (athlete_id = auth.uid());

CREATE POLICY "manager reads team sessions" ON public.sessions
  FOR SELECT USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'manager'
    AND (SELECT team_id FROM public.profiles WHERE id = sessions.athlete_id)
        = public.my_team_id()
  );

-- session_metrics: follow session access
CREATE POLICY "athlete owns session metrics" ON public.session_metrics
  FOR ALL USING (
    (SELECT athlete_id FROM public.sessions WHERE id = session_metrics.session_id)
    = auth.uid()
  ) WITH CHECK (
    (SELECT athlete_id FROM public.sessions WHERE id = session_metrics.session_id)
    = auth.uid()
  );

CREATE POLICY "manager reads team session metrics" ON public.session_metrics
  FOR SELECT USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'manager'
    AND (
      SELECT team_id FROM public.profiles
      WHERE id = (SELECT athlete_id FROM public.sessions WHERE id = session_metrics.session_id)
    ) = public.my_team_id()
  );

-- notifications: all team members can read; athletes + managers can insert
CREATE POLICY "team notifications read" ON public.notifications
  FOR SELECT USING (team_id = public.my_team_id());

CREATE POLICY "team notifications insert" ON public.notifications
  FOR INSERT WITH CHECK (team_id = public.my_team_id());

-- notification_reads: managers manage their own
CREATE POLICY "own notification reads" ON public.notification_reads
  FOR ALL USING (manager_id = auth.uid())
  WITH CHECK (manager_id = auth.uid());


-- ─────────────────────────────────────────────────────────────────────────────

-- APeX Â· Invite Codes + Sign-up Functions
-- Run this AFTER 001_schema.sql.
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

-- â”€â”€ Invite code column on teams â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

ALTER TABLE public.teams ADD COLUMN invite_code TEXT;

-- Auto-fill any existing teams (deterministic: based on UUID)
UPDATE public.teams
SET invite_code = upper(substr(md5(id::text), 1, 6))
WHERE invite_code IS NULL;

ALTER TABLE public.teams ALTER COLUMN invite_code SET NOT NULL;
ALTER TABLE public.teams ADD CONSTRAINT teams_invite_code_key UNIQUE (invite_code);

-- â”€â”€ Public code lookup (used during sign-up, before the user has a profile) â”€â”€

CREATE OR REPLACE FUNCTION public.get_team_by_invite_code(p_code TEXT)
RETURNS TABLE(team_id UUID, team_name TEXT) LANGUAGE sql SECURITY DEFINER AS $$
  SELECT id, name FROM public.teams WHERE invite_code = upper(trim(p_code));
$$;

-- â”€â”€ Manager sign-up: create team + profile in one transaction â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE OR REPLACE FUNCTION public.create_manager_team(p_team_name TEXT, p_full_name TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_team_id UUID;
  v_code    TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  -- Generate a collision-free 6-char code
  LOOP
    v_code := upper(substr(md5(random()::text || auth.uid()::text || now()::text), 1, 6));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.teams WHERE invite_code = v_code);
  END LOOP;

  INSERT INTO public.teams (name, invite_code) VALUES (p_team_name, v_code) RETURNING id INTO v_team_id;

  INSERT INTO public.team_settings (team_id) VALUES (v_team_id);

  INSERT INTO public.required_tests (team_id, label, enabled, sort_order) VALUES
    (v_team_id, 'Jump Test',      TRUE,  0),
    (v_team_id, 'Squat Test',     TRUE,  1),
    (v_team_id, 'Balance Test',   TRUE,  2),
    (v_team_id, 'Single-Leg Hop', FALSE, 3);

  INSERT INTO public.profiles (id, role, team_id, full_name)
  VALUES (auth.uid(), 'manager', v_team_id, p_full_name);

  RETURN v_team_id;
END;
$$;

-- â”€â”€ Athlete sign-up: validate invite code + create profile â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE OR REPLACE FUNCTION public.join_team_as_athlete(p_invite_code TEXT, p_full_name TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_team_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT id INTO v_team_id
  FROM public.teams WHERE invite_code = upper(trim(p_invite_code));

  IF v_team_id IS NULL THEN RAISE EXCEPTION 'Invalid invite code'; END IF;

  INSERT INTO public.profiles (id, role, team_id, full_name)
  VALUES (auth.uid(), 'athlete', v_team_id, p_full_name);

  INSERT INTO public.athlete_profiles (id) VALUES (auth.uid());

  RETURN v_team_id;
END;
$$;

-- â”€â”€ Manager: regenerate invite code â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE OR REPLACE FUNCTION public.regenerate_invite_code(p_team_id UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_code TEXT;
BEGIN
  IF (SELECT role     FROM public.profiles WHERE id = auth.uid()) != 'manager'
  OR (SELECT team_id  FROM public.profiles WHERE id = auth.uid()) != p_team_id THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  LOOP
    v_code := upper(substr(md5(random()::text || now()::text), 1, 6));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.teams WHERE invite_code = v_code);
  END LOOP;

  UPDATE public.teams SET invite_code = v_code WHERE id = p_team_id;
  RETURN v_code;
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────

-- APeX Â· Dev Seed Data
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- PREREQUISITES
--   1. Run 001_schema.sql first.
--   2. In Supabase Dashboard â†’ Authentication â†’ Providers â†’ Email, disable
--      "Confirm email" so dev accounts can sign in immediately after signup.
--   3. Create the following users in Dashboard â†’ Authentication â†’ Users:
--        Email: daniel.cohen@apex.dev   Password: apex_dev_123
--        Email: noa.levy@apex.dev       Password: apex_dev_123
--        Email: amit.bar@apex.dev       Password: apex_dev_123
--        Email: coach@apex.dev          Password: apex_dev_123
--   4. Then run this entire file in the SQL Editor.
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE OR REPLACE FUNCTION public.seed_dev_data()
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_team_id    UUID;
  v_daniel_id  UUID;
  v_noa_id     UUID;
  v_amit_id    UUID;
  v_coach_id   UUID;
  v_session_id UUID;

  -- Readiness arcs (oldest â†’ newest, 10 sessions each)
  daniel_readiness  INT[] := ARRAY[82,87,85,89,88,86,90,88,91,91];
  noa_readiness     INT[] := ARRAY[82,80,84,78,81,76,79,74,77,74];
  amit_readiness    INT[] := ARRAY[78,75,71,73,68,65,68,63,64,61];

  -- ROM arcs
  daniel_squat_rom  FLOAT[] := ARRAY[72,74,75,77,76,75,79,77,80,80];
  daniel_jump_rom   FLOAT[] := ARRAY[80,82,83,85,84,83,87,85,88,88];
  noa_squat_rom     FLOAT[] := ARRAY[74,72,75,70,73,68,71,66,69,67];
  noa_jump_rom      FLOAT[] := ARRAY[82,80,83,78,81,76,79,74,77,74];
  amit_squat_rom    FLOAT[] := ARRAY[70,68,64,66,62,59,62,57,58,55];
  amit_jump_rom     FLOAT[] := ARRAY[76,74,70,72,68,65,68,63,64,61];

  -- Jump flight times (seconds)
  daniel_flight  FLOAT[] := ARRAY[0.44,0.46,0.45,0.48,0.47,0.46,0.49,0.48,0.50,0.49];
  noa_flight     FLOAT[] := ARRAY[0.43,0.42,0.44,0.41,0.42,0.40,0.41,0.39,0.40,0.39];
  amit_flight    FLOAT[] := ARRAY[0.41,0.39,0.37,0.38,0.35,0.33,0.35,0.32,0.33,0.31];

  i INT;
  ex_type TEXT;
  rom_val FLOAT;
  flight_val FLOAT;
  lr_val FLOAT;
BEGIN
  -- Resolve user IDs from auth.users
  SELECT id INTO v_daniel_id FROM auth.users WHERE email = 'daniel.cohen@apex.dev';
  SELECT id INTO v_noa_id    FROM auth.users WHERE email = 'noa.levy@apex.dev';
  SELECT id INTO v_amit_id   FROM auth.users WHERE email = 'amit.bar@apex.dev';
  SELECT id INTO v_coach_id  FROM auth.users WHERE email = 'coach@apex.dev';

  IF v_daniel_id IS NULL OR v_noa_id IS NULL OR v_amit_id IS NULL OR v_coach_id IS NULL THEN
    RAISE EXCEPTION 'One or more dev users not found in auth.users. Create them in the Supabase dashboard first.';
  END IF;

  -- Skip if already seeded
  IF EXISTS (SELECT 1 FROM public.teams WHERE name = 'Wingate U21') THEN
    RETURN 'Already seeded â€” skipping.';
  END IF;

  -- â”€â”€ Team â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  -- 'APEX01' is the fixed dev invite code athletes use during sign-up
  INSERT INTO public.teams (name, invite_code)
  VALUES ('Wingate U21', 'APEX01')
  RETURNING id INTO v_team_id;

  INSERT INTO public.team_settings (team_id, readiness_threshold, max_lr_imbalance, required_tests_per_day)
  VALUES (v_team_id, 75, 15, 3);

  INSERT INTO public.required_tests (team_id, label, enabled, sort_order) VALUES
    (v_team_id, 'Jump Test',       TRUE,  0),
    (v_team_id, 'Squat Test',      TRUE,  1),
    (v_team_id, 'Balance Test',    TRUE,  2),
    (v_team_id, 'Single-Leg Hop',  FALSE, 3);

  -- â”€â”€ Profiles â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  INSERT INTO public.profiles (id, role, team_id, full_name) VALUES
    (v_daniel_id, 'athlete', v_team_id, 'Daniel Cohen'),
    (v_noa_id,    'athlete', v_team_id, 'Noa Levy'),
    (v_amit_id,   'athlete', v_team_id, 'Amit Bar'),
    (v_coach_id,  'manager', v_team_id, 'Head Coach');

  INSERT INTO public.athlete_profiles (id, height_cm, weight_kg, position, date_of_birth) VALUES
    (v_daniel_id, 181, 78, 'Forward',    '2004-06-15'),
    (v_noa_id,    174, 64, 'Midfielder', '2005-03-22'),
    (v_amit_id,   185, 83, 'Defender',   '2003-11-08');

  -- â”€â”€ Sessions â€” Daniel Cohen (improving arc) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  -- Sessions alternate squat (odd index) / jump (even index), 10 days ago â†’ 1 day ago
  FOR i IN 1..10 LOOP
    ex_type    := CASE WHEN i % 2 = 1 THEN 'squat' ELSE 'jump' END;
    rom_val    := CASE WHEN ex_type = 'squat' THEN daniel_squat_rom[i] ELSE daniel_jump_rom[i] END;
    flight_val := daniel_flight[i];
    lr_val     := CASE WHEN i <= 4 THEN 5.0 ELSE 4.0 END; -- slight improvement

    INSERT INTO public.sessions (id, athlete_id, exercise_type, recorded_at, rep_count, readiness_score, analysis_json)
    VALUES (
      gen_random_uuid(), v_daniel_id, ex_type,
      NOW() - ((11 - i) || ' days')::INTERVAL + (8 * 60 * '1 minute'::INTERVAL),
      CASE WHEN ex_type = 'squat' THEN 5 ELSE 10 END,
      daniel_readiness[i],
      jsonb_build_object('readiness', daniel_readiness[i], 'exercise', ex_type)
    )
    RETURNING id INTO v_session_id;

    INSERT INTO public.session_metrics (session_id, metric_key, value) VALUES
      (v_session_id, ex_type || '_rom_deg',   rom_val),
      (v_session_id, 'lr_imbalance_pct',      lr_val),
      (v_session_id, ex_type || '_reps',      CASE WHEN ex_type = 'squat' THEN 5 ELSE 10 END);

    IF ex_type = 'jump' THEN
      INSERT INTO public.session_metrics (session_id, metric_key, value)
      VALUES (v_session_id, 'flight_time_s', flight_val);
    END IF;
  END LOOP;

  -- â”€â”€ Sessions â€” Noa Levy (declining, L/R issue) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  FOR i IN 1..10 LOOP
    ex_type := CASE WHEN i % 2 = 1 THEN 'squat' ELSE 'jump' END;
    rom_val := CASE WHEN ex_type = 'squat' THEN noa_squat_rom[i] ELSE noa_jump_rom[i] END;

    INSERT INTO public.sessions (id, athlete_id, exercise_type, recorded_at, rep_count, readiness_score, analysis_json)
    VALUES (
      gen_random_uuid(), v_noa_id, ex_type,
      NOW() - ((11 - i) || ' days')::INTERVAL + (7.5 * 60 * '1 minute'::INTERVAL),
      CASE WHEN ex_type = 'squat' THEN 4 ELSE 9 END,
      noa_readiness[i],
      jsonb_build_object('readiness', noa_readiness[i], 'exercise', ex_type)
    )
    RETURNING id INTO v_session_id;

    INSERT INTO public.session_metrics (session_id, metric_key, value) VALUES
      (v_session_id, ex_type || '_rom_deg',  rom_val),
      (v_session_id, 'lr_imbalance_pct',     11.0 + (i * 0.3)), -- worsening imbalance
      (v_session_id, ex_type || '_reps',     CASE WHEN ex_type = 'squat' THEN 4 ELSE 9 END);

    IF ex_type = 'jump' THEN
      INSERT INTO public.session_metrics (session_id, metric_key, value)
      VALUES (v_session_id, 'flight_time_s', noa_flight[i]);
    END IF;
  END LOOP;

  -- â”€â”€ Sessions â€” Amit Bar (clear decline, high imbalance) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  FOR i IN 1..10 LOOP
    ex_type := CASE WHEN i % 2 = 1 THEN 'squat' ELSE 'jump' END;
    rom_val := CASE WHEN ex_type = 'squat' THEN amit_squat_rom[i] ELSE amit_jump_rom[i] END;

    INSERT INTO public.sessions (id, athlete_id, exercise_type, recorded_at, rep_count, readiness_score, analysis_json)
    VALUES (
      gen_random_uuid(), v_amit_id, ex_type,
      NOW() - ((11 - i) || ' days')::INTERVAL + (7 * 60 * '1 minute'::INTERVAL),
      CASE WHEN ex_type = 'squat' THEN 3 ELSE 7 END,
      amit_readiness[i],
      jsonb_build_object('readiness', amit_readiness[i], 'exercise', ex_type)
    )
    RETURNING id INTO v_session_id;

    INSERT INTO public.session_metrics (session_id, metric_key, value) VALUES
      (v_session_id, ex_type || '_rom_deg',  rom_val),
      (v_session_id, 'lr_imbalance_pct',     18.0 + (i * 0.5)), -- high and worsening
      (v_session_id, ex_type || '_reps',     CASE WHEN ex_type = 'squat' THEN 3 ELSE 7 END);

    IF ex_type = 'jump' THEN
      INSERT INTO public.session_metrics (session_id, metric_key, value)
      VALUES (v_session_id, 'flight_time_s', amit_flight[i]);
    END IF;
  END LOOP;

  -- â”€â”€ Notifications â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  INSERT INTO public.notifications (team_id, athlete_id, message, severity) VALUES
    (v_team_id, v_amit_id,  'Amit Bar readiness dropped 12% from baseline', 'critical'),
    (v_team_id, v_noa_id,   'Noa Levy shows increased L/R imbalance (13%)', 'warning'),
    (v_team_id, v_daniel_id,'Daniel Cohen missed today''s jump test',         'warning'),
    (v_team_id, NULL,       '2 athletes require immediate review',             'info');

  RETURN 'Seeded: Wingate U21 team, 3 athletes, 30 sessions, 4 notifications.';
END $$;

