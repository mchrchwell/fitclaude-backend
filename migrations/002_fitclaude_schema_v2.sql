-- ============================================================
-- FitClaude Schema v2 — Migration 002
-- Evolves from 001: new tables + data migration
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- USERS: add display_name, drop name; active_plan_id added later
-- ============================================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'name') THEN
    UPDATE users SET display_name = name WHERE name IS NOT NULL AND (display_name IS NULL OR display_name = '');
    ALTER TABLE users DROP COLUMN name;
  END IF;
END $$;

-- ============================================================
-- USER PROFILES (replace profiles)
-- ============================================================
CREATE TABLE IF NOT EXISTS user_profiles (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  age           INT,
  height_cm     NUMERIC(5,1),
  weight_kg     NUMERIC(5,1),
  equipment     JSONB NOT NULL DEFAULT '[]',
  injuries      JSONB NOT NULL DEFAULT '[]',
  goals         JSONB NOT NULL DEFAULT '[]',
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Migrate from profiles if it exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'profiles') THEN
    INSERT INTO user_profiles (user_id, age, height_cm, weight_kg, equipment, injuries, goals, notes, updated_at)
    SELECT p.user_id, p.age, p.height_cm, p.weight_kg, '[]'::jsonb, '[]'::jsonb,
           CASE WHEN p.goals IS NULL OR p.goals = '' THEN '[]'::jsonb ELSE to_jsonb(ARRAY[p.goals]) END,
           NULL, COALESCE(p.updated_at, NOW())
    FROM profiles p
    ON CONFLICT (user_id) DO NOTHING;
    DROP TABLE profiles;
  END IF;
END $$;

-- ============================================================
-- WORKOUT PLANS (replace plans)
-- ============================================================
CREATE TABLE IF NOT EXISTS workout_plans (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  raw_claude_json JSONB,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_plan_per_user
  ON workout_plans(user_id) WHERE is_active = TRUE;

-- Migrate from plans if it exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'plans') THEN
    INSERT INTO workout_plans (id, user_id, name, description, is_active, created_at, updated_at)
    SELECT id, user_id, name, description, true, created_at, updated_at FROM plans;
  END IF;
END $$;

-- ============================================================
-- PLAN DAYS
-- ============================================================
CREATE TABLE IF NOT EXISTS plan_days (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_id       UUID NOT NULL REFERENCES workout_plans(id) ON DELETE CASCADE,
  day_label     TEXT NOT NULL,
  name          TEXT NOT NULL,
  focus         TEXT,
  sort_order    INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- PLAN EXERCISES
-- ============================================================
CREATE TABLE IF NOT EXISTS plan_exercises (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_day_id     UUID NOT NULL REFERENCES plan_days(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  prescribed_sets INT NOT NULL DEFAULT 3,
  prescribed_reps TEXT NOT NULL DEFAULT '10',
  start_weight_kg NUMERIC(6,2),
  notes           TEXT,
  sort_order      INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TABLE IF EXISTS plans CASCADE;

-- ============================================================
-- WORKOUT SESSIONS (replace workouts)
-- ============================================================
CREATE TABLE IF NOT EXISTS workout_sessions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_day_id     UUID REFERENCES plan_days(id) ON DELETE SET NULL,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at     TIMESTAMPTZ,
  notes           TEXT,
  perceived_effort INT CHECK (perceived_effort IS NULL OR (perceived_effort BETWEEN 1 AND 10)),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Migrate from workouts if it exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'workouts') THEN
    INSERT INTO workout_sessions (user_id, plan_day_id, started_at, finished_at, notes, created_at)
    SELECT user_id, NULL, created_at, completed_at, notes, created_at FROM workouts;
    DROP TABLE workouts;
  END IF;
END $$;

-- ============================================================
-- LOGGED SETS
-- ============================================================
CREATE TABLE IF NOT EXISTS logged_sets (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id          UUID NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
  plan_exercise_id    UUID REFERENCES plan_exercises(id) ON DELETE SET NULL,
  exercise_name       TEXT NOT NULL,
  set_number          INT NOT NULL,
  reps_completed      INT,
  weight_kg           NUMERIC(6,2),
  duration_seconds    INT,
  is_completed        BOOLEAN NOT NULL DEFAULT FALSE,
  performance_data    JSONB NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- CONVERSATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS conversations (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         TEXT,
  context_type  TEXT NOT NULL DEFAULT 'general',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- MESSAGES (replace chat_messages)
-- ============================================================
CREATE TABLE IF NOT EXISTS messages (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content         TEXT NOT NULL,
  token_estimate  INT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One conversation per user, then migrate chat_messages into messages
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'chat_messages') THEN
    INSERT INTO conversations (user_id, context_type)
    SELECT DISTINCT user_id, 'general' FROM chat_messages;
    INSERT INTO messages (conversation_id, role, content)
    SELECT c.id, cm.role, cm.content
    FROM chat_messages cm
    JOIN conversations c ON c.user_id = cm.user_id
    ORDER BY cm.created_at;
    DROP TABLE chat_messages;
  END IF;
END $$;

-- ============================================================
-- ACTIVE PLAN POINTER on users
-- ============================================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS active_plan_id UUID REFERENCES workout_plans(id) ON DELETE SET NULL;

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id         ON user_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_workout_plans_user_id          ON workout_plans(user_id);
CREATE INDEX IF NOT EXISTS idx_plan_days_plan_id             ON plan_days(plan_id);
CREATE INDEX IF NOT EXISTS idx_plan_exercises_plan_day_id    ON plan_exercises(plan_day_id);
CREATE INDEX IF NOT EXISTS idx_workout_sessions_user_id      ON workout_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_workout_sessions_plan_day_id  ON workout_sessions(plan_day_id);
CREATE INDEX IF NOT EXISTS idx_logged_sets_session_id       ON logged_sets(session_id);
CREATE INDEX IF NOT EXISTS idx_logged_sets_exercise_name     ON logged_sets(exercise_name);
CREATE INDEX IF NOT EXISTS idx_conversations_user_id         ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id      ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at           ON messages(created_at);

-- ============================================================
-- UPDATED_AT TRIGGER
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_user_profiles_updated_at ON user_profiles;
CREATE TRIGGER trg_user_profiles_updated_at BEFORE UPDATE ON user_profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_workout_plans_updated_at ON workout_plans;
CREATE TRIGGER trg_workout_plans_updated_at BEFORE UPDATE ON workout_plans FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_conversations_updated_at ON conversations;
CREATE TRIGGER trg_conversations_updated_at BEFORE UPDATE ON conversations FOR EACH ROW EXECUTE FUNCTION set_updated_at();
