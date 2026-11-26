-- Historical source material is kept separate from active reports and scoring.
CREATE TABLE IF NOT EXISTS historical_report_archives (
  id TEXT PRIMARY KEY,
  source_system TEXT NOT NULL CHECK(source_system = 'reportos'),
  source_report_id TEXT NOT NULL,
  employee_user_id TEXT NOT NULL REFERENCES employees(user_id),
  employee_name TEXT NOT NULL,
  department TEXT NOT NULL,
  week_label TEXT NOT NULL,
  week_start TEXT NOT NULL,
  week_end TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  status TEXT NOT NULL,
  content_json TEXT NOT NULL CHECK(json_valid(content_json)),
  recovered_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(recovered_json)),
  provenance_json TEXT NOT NULL CHECK(json_valid(provenance_json)),
  source_sha256 TEXT NOT NULL CHECK(length(source_sha256) = 64),
  import_batch_id TEXT NOT NULL,
  archived_at TEXT NOT NULL,
  CHECK(id = 'reportos:' || source_report_id),
  CHECK(week_start <= week_end),
  UNIQUE(source_system, source_report_id)
);
CREATE INDEX IF NOT EXISTS historical_report_archives_person_period
  ON historical_report_archives(employee_user_id, week_end, source_report_id);
CREATE TRIGGER IF NOT EXISTS historical_report_archives_no_update
  BEFORE UPDATE ON historical_report_archives
  BEGIN SELECT RAISE(ABORT, 'historical_archive_locked'); END;
CREATE TRIGGER IF NOT EXISTS historical_report_archives_no_delete
  BEFORE DELETE ON historical_report_archives
  BEGIN SELECT RAISE(ABORT, 'historical_archive_locked'); END;
