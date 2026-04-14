-- planning_sessions: tracks daily/weekly planning prompt windows
CREATE TABLE IF NOT EXISTS planning_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  window_type text NOT NULL CHECK (window_type IN ('daily', 'weekly')),
  window_date date NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  dismissed_at timestamptz,
  tasks_promoted integer DEFAULT 0,
  tasks_added integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, window_type, window_date)
);

-- user_settings: per-user preferences (e.g. planning prompt opt-out)
CREATE TABLE IF NOT EXISTS user_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  daily_planning_enabled boolean NOT NULL DEFAULT true,
  weekly_planning_enabled boolean NOT NULL DEFAULT true,
  planning_snooze_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- updated_at trigger for user_settings
CREATE OR REPLACE FUNCTION update_user_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_user_settings_updated_at
  BEFORE UPDATE ON user_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_user_settings_updated_at();

-- RLS policies for planning_sessions
ALTER TABLE planning_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY planning_sessions_select ON planning_sessions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY planning_sessions_insert ON planning_sessions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY planning_sessions_update ON planning_sessions
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY planning_sessions_delete ON planning_sessions
  FOR DELETE USING (auth.uid() = user_id);

-- RLS policies for user_settings
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_settings_select ON user_settings
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY user_settings_insert ON user_settings
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY user_settings_update ON user_settings
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY user_settings_delete ON user_settings
  FOR DELETE USING (auth.uid() = user_id);
