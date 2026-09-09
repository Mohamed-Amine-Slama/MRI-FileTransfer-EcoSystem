DROP FUNCTION IF EXISTS imaging_clear_twin(uuid);
DROP FUNCTION IF EXISTS imaging_reapable_twins(timestamptz);
ALTER TABLE cases_cases DROP COLUMN IF EXISTS terminal_at;
