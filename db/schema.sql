PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS employees (
  user_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  department TEXT,
  email TEXT,
  manager_user_id TEXT,
  role_level TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS visibility_policies (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  content_type TEXT NOT NULL,
  default_visibility TEXT NOT NULL,
  redaction_level TEXT NOT NULL,
  rule_json TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS import_batches (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_name TEXT,
  source_sha256 TEXT,
  imported_by_user_id TEXT,
  record_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'imported',
  imported_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS weekly_reports (
  id TEXT PRIMARY KEY,
  employee_user_id TEXT NOT NULL,
  employee_name TEXT NOT NULL,
  department TEXT,
  week_label TEXT NOT NULL,
  week_start TEXT,
  week_end TEXT,
  status TEXT,
  content_json TEXT NOT NULL,
  source_batch_id TEXT,
  source_hash TEXT,
  is_late INTEGER NOT NULL DEFAULT 0,
  submitted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(employee_user_id, week_label),
  FOREIGN KEY(source_batch_id) REFERENCES import_batches(id)
);

CREATE INDEX IF NOT EXISTS idx_weekly_reports_employee ON weekly_reports(employee_user_id);
CREATE INDEX IF NOT EXISTS idx_weekly_reports_week ON weekly_reports(week_start, week_end);

CREATE TABLE IF NOT EXISTS analysis_runs (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  source_batch_id TEXT,
  release_id TEXT,
  input_hash TEXT,
  status TEXT NOT NULL DEFAULT 'completed',
  summary_json TEXT NOT NULL DEFAULT '{}',
  started_at TEXT,
  completed_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(source_batch_id) REFERENCES import_batches(id)
);

CREATE TABLE IF NOT EXISTS analysis_items (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  item_type TEXT NOT NULL,
  priority TEXT,
  title TEXT NOT NULL,
  employee_user_id TEXT,
  department TEXT,
  visibility TEXT NOT NULL DEFAULT 'management',
  redaction_level TEXT NOT NULL DEFAULT 'summary',
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(run_id) REFERENCES analysis_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_analysis_items_run_type ON analysis_items(run_id, item_type);
CREATE INDEX IF NOT EXISTS idx_analysis_items_visibility ON analysis_items(visibility);

CREATE TABLE IF NOT EXISTS task_candidates (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  employee_user_id TEXT,
  employee_name TEXT NOT NULL,
  priority TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  due_date TEXT,
  metric TEXT,
  evidence TEXT,
  ai_intent TEXT,
  first_step TEXT,
  support_needed TEXT,
  context_need TEXT,
  selected INTEGER NOT NULL DEFAULT 0,
  created_task_guid TEXT,
  status TEXT NOT NULL DEFAULT 'candidate',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(run_id) REFERENCES analysis_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_task_candidates_employee ON task_candidates(employee_user_id, employee_name);
CREATE INDEX IF NOT EXISTS idx_task_candidates_status ON task_candidates(status);

CREATE TABLE IF NOT EXISTS feishu_tasks (
  guid TEXT PRIMARY KEY,
  candidate_id TEXT,
  idempotency_key TEXT UNIQUE,
  summary TEXT NOT NULL,
  assignee_user_id TEXT,
  due_date TEXT,
  url TEXT,
  status TEXT NOT NULL DEFAULT 'created',
  raw_response_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(candidate_id) REFERENCES task_candidates(id)
);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  author_user_id TEXT NOT NULL,
  author_name TEXT,
  body TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'department',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_comments_target ON comments(target_type, target_id);

CREATE TABLE IF NOT EXISTS ai_followup_messages (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  role TEXT NOT NULL,
  author_user_id TEXT,
  author_name TEXT,
  body TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ai_followup_messages_candidate ON ai_followup_messages(candidate_id, created_at);

CREATE TABLE IF NOT EXISTS reactions (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  reaction_type TEXT NOT NULL DEFAULT 'like',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(target_type, target_id, actor_user_id, reaction_type)
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  recipient_user_id TEXT,
  recipient_name TEXT,
  actor_user_id TEXT,
  actor_name TEXT,
  event_type TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  target_employee_name TEXT,
  title TEXT NOT NULL,
  body TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_user_id, recipient_name, read_at, created_at);

CREATE TABLE IF NOT EXISTS public_highlights (
  id TEXT PRIMARY KEY,
  weekly_report_id TEXT NOT NULL,
  employee_user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  reason TEXT,
  approved_by_user_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(weekly_report_id) REFERENCES weekly_reports(id)
);

CREATE TABLE IF NOT EXISTS external_share_links (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  name TEXT,
  scope TEXT NOT NULL DEFAULT 'boss_view',
  created_by_user_id TEXT,
  created_by_name TEXT,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  access_count INTEGER NOT NULL DEFAULT 0,
  last_accessed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_external_share_links_status ON external_share_links(status, expires_at);

CREATE TABLE IF NOT EXISTS contribution_events (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL,
  actor_name TEXT,
  event_type TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  points INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_contribution_actor ON contribution_events(actor_user_id, created_at);

CREATE TABLE IF NOT EXISTS company_message_sends (
  id TEXT PRIMARY KEY,
  period_id TEXT,
  period_label TEXT,
  chat_id TEXT NOT NULL,
  chat_name TEXT,
  original_draft TEXT NOT NULL,
  final_message TEXT NOT NULL,
  sent_by_user_id TEXT,
  sent_by_name TEXT,
  feishu_message_id TEXT,
  idempotency_key TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'sent',
  raw_response_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_company_message_sends_period ON company_message_sends(period_id, created_at);

CREATE TABLE IF NOT EXISTS weekly_reminder_sends (
  id TEXT PRIMARY KEY,
  period_id TEXT,
  period_label TEXT,
  recipient_user_id TEXT NOT NULL,
  recipient_name TEXT NOT NULL,
  department TEXT,
  message TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  identity TEXT NOT NULL DEFAULT 'bot',
  feishu_message_id TEXT,
  idempotency_key TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'sent',
  raw_response_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_weekly_reminder_sends_period ON weekly_reminder_sends(period_id, created_at);
CREATE INDEX IF NOT EXISTS idx_weekly_reminder_sends_recipient ON weekly_reminder_sends(recipient_user_id, created_at);

CREATE TABLE IF NOT EXISTS weekly_reminder_outbox (
  id TEXT PRIMARY KEY,
  period_id TEXT NOT NULL,
  period_label TEXT,
  recipient_user_id TEXT NOT NULL,
  recipient_name TEXT NOT NULL,
  department TEXT,
  message TEXT NOT NULL,
  personalization_note TEXT,
  provider TEXT NOT NULL DEFAULT 'kimi',
  model TEXT,
  prompt_hash TEXT,
  status TEXT NOT NULL DEFAULT 'prepared',
  source_json TEXT NOT NULL DEFAULT '{}',
  feishu_message_id TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(period_id, recipient_user_id)
);

CREATE INDEX IF NOT EXISTS idx_weekly_reminder_outbox_period ON weekly_reminder_outbox(period_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_weekly_reminder_outbox_recipient ON weekly_reminder_outbox(recipient_user_id, updated_at);

-- Month-end reminders are independent of peer cycles and include manager/boss tasks.
CREATE TABLE IF NOT EXISTS monthly_score_reminder_deliveries (
  month TEXT NOT NULL,
  reminder_date TEXT NOT NULL,
  recipient_user_id TEXT NOT NULL,
  recipient_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('ready','pending','sent','failed','cancelled','uncertain')),
  claim_token TEXT NOT NULL DEFAULT '',
  attempts INTEGER NOT NULL DEFAULT 0,
  message TEXT NOT NULL DEFAULT '',
  pending_json TEXT NOT NULL DEFAULT '{}',
  message_id TEXT NOT NULL DEFAULT '',
  last_error TEXT NOT NULL DEFAULT '',
  sent_at TEXT,
  first_attempt_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(month,reminder_date,recipient_user_id)
);

CREATE TABLE IF NOT EXISTS scoring360_cycles (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'monthly',
  start_date TEXT,
  end_date TEXT,
  launch_at TEXT,
  due_at TEXT,
  followup_after_at TEXT,
  historical_weight REAL NOT NULL DEFAULT 0.3,
  current_weight REAL NOT NULL DEFAULT 0.7,
  status TEXT NOT NULL DEFAULT 'draft',
  total_employees INTEGER NOT NULL DEFAULT 0,
  total_evaluees INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scoring360_assignments (
  id TEXT PRIMARY KEY,
  cycle_id TEXT NOT NULL,
  evaluee_name TEXT NOT NULL,
  evaluator_name TEXT NOT NULL,
  evaluee_user_id TEXT,
  evaluator_user_id TEXT,
  relationship TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(cycle_id, evaluee_user_id, evaluator_user_id),
  FOREIGN KEY(cycle_id) REFERENCES scoring360_cycles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_scoring360_assignments_evaluator ON scoring360_assignments(cycle_id, evaluator_name);
CREATE INDEX IF NOT EXISTS idx_scoring360_assignments_evaluee ON scoring360_assignments(cycle_id, evaluee_name);

CREATE TABLE IF NOT EXISTS scoring360_responses (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL,
  cycle_id TEXT NOT NULL,
  evaluee_name TEXT NOT NULL,
  evaluator_name TEXT NOT NULL,
  score INTEGER NOT NULL,
  dimension_scores_json TEXT NOT NULL DEFAULT '{}',
  comment TEXT,
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(assignment_id),
  CHECK(score >= 0 AND score <= 100),
  FOREIGN KEY(assignment_id) REFERENCES scoring360_assignments(id) ON DELETE CASCADE,
  FOREIGN KEY(cycle_id) REFERENCES scoring360_cycles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_scoring360_responses_cycle_evaluee ON scoring360_responses(cycle_id, evaluee_name);
CREATE INDEX IF NOT EXISTS idx_scoring360_responses_cycle_evaluator ON scoring360_responses(cycle_id, evaluator_name);

CREATE TABLE IF NOT EXISTS scoring360_reminder_sends (
  id TEXT PRIMARY KEY,
  cycle_id TEXT NOT NULL,
  cycle_label TEXT,
  evaluator_user_id TEXT,
  evaluator_name TEXT NOT NULL,
  pending_count INTEGER NOT NULL DEFAULT 0,
  message TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'launch',
  source TEXT NOT NULL DEFAULT 'manual',
  identity TEXT NOT NULL DEFAULT 'bot',
  feishu_message_id TEXT,
  idempotency_key TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'dry_run',
  raw_response_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(cycle_id) REFERENCES scoring360_cycles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_scoring360_reminder_sends_cycle ON scoring360_reminder_sends(cycle_id, kind, status, created_at);

CREATE TABLE IF NOT EXISTS lark_auth_monitor_sends (
  id TEXT PRIMARY KEY,
  app_id TEXT,
  user_id TEXT,
  user_name TEXT,
  threshold_hours INTEGER NOT NULL,
  refresh_expires_at TEXT NOT NULL,
  message TEXT NOT NULL,
  identity TEXT NOT NULL DEFAULT 'bot',
  feishu_message_id TEXT,
  idempotency_key TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'sent',
  raw_response_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(app_id, user_id, threshold_hours, refresh_expires_at)
);

CREATE INDEX IF NOT EXISTS idx_lark_auth_monitor_sends_user ON lark_auth_monitor_sends(user_id, refresh_expires_at, threshold_hours);

INSERT OR IGNORE INTO schema_migrations (version) VALUES ('2026-05-16-001-initial-weekly-report-os');
INSERT OR IGNORE INTO schema_migrations (version) VALUES ('2026-06-04-001-scoring360');
INSERT OR IGNORE INTO schema_migrations (version) VALUES ('2026-06-12-001-scoring360-reminders');
INSERT OR IGNORE INTO schema_migrations (version) VALUES ('2026-06-29-001-lark-auth-monitor');

-- Published immutable snapshots, separate from AI candidates and raw responses.
CREATE TABLE IF NOT EXISTS performance_results (
  month TEXT NOT NULL, employee_user_id TEXT NOT NULL, employee_name TEXT NOT NULL, kind TEXT NOT NULL,
  result_json TEXT NOT NULL, evidence_json TEXT NOT NULL, confirmed_by TEXT NOT NULL,
  confirmed_at TEXT NOT NULL, PRIMARY KEY(month, employee_user_id, kind)
);
CREATE TRIGGER IF NOT EXISTS performance_results_no_update BEFORE UPDATE ON performance_results BEGIN SELECT RAISE(ABORT, 'result_locked'); END;
CREATE TRIGGER IF NOT EXISTS performance_results_no_delete BEFORE DELETE ON performance_results BEGIN SELECT RAISE(ABORT, 'result_locked'); END;

-- Automatic quality/statistics revisions are append-only so monthly totals can evolve.
-- Existing manually published history remains authoritative and is never overwritten.
CREATE TABLE IF NOT EXISTS automatic_performance_results (
  id TEXT PRIMARY KEY,
  month TEXT NOT NULL,
  employee_user_id TEXT NOT NULL,
  employee_name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('quality','timeliness')),
  calculation_hash TEXT NOT NULL,
  result_json TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  calculated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_automatic_performance_latest ON automatic_performance_results(month,employee_user_id,kind);
CREATE TRIGGER IF NOT EXISTS automatic_performance_no_update BEFORE UPDATE ON automatic_performance_results BEGIN SELECT RAISE(ABORT,'automatic_history_locked'); END;
CREATE TRIGGER IF NOT EXISTS automatic_performance_no_delete BEFORE DELETE ON automatic_performance_results BEGIN SELECT RAISE(ABORT,'automatic_history_locked'); END;

BEGIN;
CREATE TRIGGER IF NOT EXISTS scoring360_responses_published_insert BEFORE INSERT ON scoring360_responses
WHEN EXISTS(SELECT 1 FROM performance_results p JOIN scoring360_cycles c ON substr(c.start_date,1,7)=p.month WHERE p.kind='collaboration' AND c.id=NEW.cycle_id AND p.employee_user_id=(SELECT evaluee_user_id FROM scoring360_assignments WHERE id=NEW.assignment_id))
BEGIN SELECT RAISE(ABORT, 'result_locked'); END;
CREATE TRIGGER IF NOT EXISTS scoring360_responses_published_update BEFORE UPDATE ON scoring360_responses
WHEN EXISTS(SELECT 1 FROM performance_results p JOIN scoring360_cycles c ON substr(c.start_date,1,7)=p.month WHERE p.kind='collaboration' AND c.id=OLD.cycle_id AND p.employee_user_id=(SELECT evaluee_user_id FROM scoring360_assignments WHERE id=OLD.assignment_id)) OR EXISTS(SELECT 1 FROM performance_results p JOIN scoring360_cycles c ON substr(c.start_date,1,7)=p.month WHERE p.kind='collaboration' AND c.id=NEW.cycle_id AND p.employee_user_id=(SELECT evaluee_user_id FROM scoring360_assignments WHERE id=NEW.assignment_id))
BEGIN SELECT RAISE(ABORT, 'result_locked'); END;
CREATE TRIGGER IF NOT EXISTS scoring360_responses_published_delete BEFORE DELETE ON scoring360_responses
WHEN EXISTS(SELECT 1 FROM performance_results p JOIN scoring360_cycles c ON substr(c.start_date,1,7)=p.month WHERE p.kind='collaboration' AND c.id=OLD.cycle_id AND p.employee_user_id=(SELECT evaluee_user_id FROM scoring360_assignments WHERE id=OLD.assignment_id))
BEGIN SELECT RAISE(ABORT, 'result_locked'); END;
CREATE TRIGGER IF NOT EXISTS scoring360_assignments_published_insert BEFORE INSERT ON scoring360_assignments
WHEN EXISTS(SELECT 1 FROM performance_results p JOIN scoring360_cycles c ON substr(c.start_date,1,7)=p.month WHERE p.kind='collaboration' AND c.id=NEW.cycle_id AND p.employee_user_id=NEW.evaluee_user_id)
BEGIN SELECT RAISE(ABORT, 'result_locked'); END;
CREATE TRIGGER IF NOT EXISTS scoring360_assignments_published_update BEFORE UPDATE ON scoring360_assignments
WHEN EXISTS(SELECT 1 FROM performance_results p JOIN scoring360_cycles c ON substr(c.start_date,1,7)=p.month WHERE p.kind='collaboration' AND c.id=OLD.cycle_id AND p.employee_user_id=OLD.evaluee_user_id) OR EXISTS(SELECT 1 FROM performance_results p JOIN scoring360_cycles c ON substr(c.start_date,1,7)=p.month WHERE p.kind='collaboration' AND c.id=NEW.cycle_id AND p.employee_user_id=NEW.evaluee_user_id)
BEGIN SELECT RAISE(ABORT, 'result_locked'); END;
CREATE TRIGGER IF NOT EXISTS scoring360_assignments_published_delete BEFORE DELETE ON scoring360_assignments
WHEN EXISTS(SELECT 1 FROM performance_results p JOIN scoring360_cycles c ON substr(c.start_date,1,7)=p.month WHERE p.kind='collaboration' AND c.id=OLD.cycle_id AND p.employee_user_id=OLD.evaluee_user_id)
BEGIN SELECT RAISE(ABORT, 'result_locked'); END;
CREATE TRIGGER IF NOT EXISTS performance_collaboration_complete BEFORE INSERT ON performance_results
WHEN NEW.kind='collaboration' AND (
  NOT EXISTS(SELECT 1 FROM scoring360_assignments a JOIN scoring360_cycles c ON c.id=a.cycle_id WHERE substr(c.start_date,1,7)=NEW.month AND a.evaluee_user_id=NEW.employee_user_id AND COALESCE(a.status,'active')='active')
  OR EXISTS(SELECT 1 FROM scoring360_assignments a JOIN scoring360_cycles c ON c.id=a.cycle_id LEFT JOIN scoring360_responses r ON r.assignment_id=a.id WHERE substr(c.start_date,1,7)=NEW.month AND a.evaluee_user_id=NEW.employee_user_id AND (COALESCE(a.status,'active')='active' OR r.id IS NOT NULL) AND (r.id IS NULL OR trim(COALESCE(r.comment,''))=''))
  OR (SELECT ROUND(AVG(r.score),1) FROM scoring360_responses r JOIN scoring360_cycles c ON c.id=r.cycle_id WHERE substr(c.start_date,1,7)=NEW.month AND r.assignment_id IN (SELECT id FROM scoring360_assignments WHERE evaluee_user_id=NEW.employee_user_id)) != json_extract(NEW.result_json,'$.score')
)
BEGIN SELECT RAISE(ABORT, 'scoring_incomplete_or_changed'); END;
COMMIT;
CREATE TRIGGER IF NOT EXISTS scoring360_cycles_published_update BEFORE UPDATE OF id,start_date,end_date ON scoring360_cycles
WHEN EXISTS(SELECT 1 FROM performance_results WHERE kind='collaboration' AND month=substr(OLD.start_date,1,7))
BEGIN SELECT RAISE(ABORT, 'result_locked'); END;
CREATE TRIGGER IF NOT EXISTS scoring360_cycles_published_delete BEFORE DELETE ON scoring360_cycles
WHEN EXISTS(SELECT 1 FROM performance_results WHERE kind='collaboration' AND month=substr(OLD.start_date,1,7))
BEGIN SELECT RAISE(ABORT, 'result_locked'); END;

CREATE TABLE IF NOT EXISTS personal_task_drafts (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  week_id TEXT NOT NULL,
  draft_json TEXT NOT NULL,
  feishu_guid TEXT,
  feishu_url TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_personal_task_owner_week ON personal_task_drafts(owner_user_id,week_id);
CREATE TABLE IF NOT EXISTS personal_coach_messages (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  week_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user','assistant')),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_personal_coach_owner_week ON personal_coach_messages(owner_user_id,week_id);

CREATE TABLE IF NOT EXISTS employee_sso_logins (
 user_id TEXT PRIMARY KEY, last_login_at TEXT NOT NULL, sync_note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS personal_scoring_reminders (
 id TEXT PRIMARY KEY, requester_user_id TEXT NOT NULL, month TEXT NOT NULL,
 recipient_user_id TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, message_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_personal_scoring_reminders ON personal_scoring_reminders(requester_user_id,month,recipient_user_id,created_at);

CREATE TABLE IF NOT EXISTS organization_departments (
 id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE,leader_user_id TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS department_leader_scores (
 department_id TEXT NOT NULL,month TEXT NOT NULL,leader_user_id TEXT NOT NULL,score REAL NOT NULL CHECK(score>=0 AND score<=100),
 comment TEXT NOT NULL,scorer_user_id TEXT NOT NULL,scorer_name TEXT NOT NULL,created_at TEXT NOT NULL,
 PRIMARY KEY(department_id,month)
);
CREATE TRIGGER IF NOT EXISTS department_scores_no_update BEFORE UPDATE ON department_leader_scores BEGIN SELECT RAISE(ABORT,'result_locked'); END;
CREATE TRIGGER IF NOT EXISTS department_scores_no_delete BEFORE DELETE ON department_leader_scores BEGIN SELECT RAISE(ABORT,'result_locked'); END;

CREATE TABLE IF NOT EXISTS system_policy_versions (
 effective_month TEXT PRIMARY KEY,policy_json TEXT NOT NULL,created_by TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS system_operation_logs (
 id TEXT PRIMARY KEY,actor_user_id TEXT,actor_name TEXT,action TEXT NOT NULL,details_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS department_hierarchy (department_id TEXT PRIMARY KEY,parent_id TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS department_local_settings (
 department_id TEXT PRIMARY KEY, sort_order INTEGER NOT NULL DEFAULT 0,
 leader_mode TEXT NOT NULL DEFAULT 'primary', is_active INTEGER NOT NULL DEFAULT 1,
 aliases_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS feishu_department_links (
 open_department_id TEXT PRIMARY KEY,
 department_id TEXT NOT NULL UNIQUE,
 parent_open_department_id TEXT NOT NULL DEFAULT '',
 aliases_json TEXT NOT NULL DEFAULT '[]',
 leader_name TEXT NOT NULL DEFAULT '',
 member_count INTEGER,
 synced_at TEXT NOT NULL,
 raw_json TEXT NOT NULL
);

-- user_id is the only business identity. Other Feishu IDs are interoperability aliases.
CREATE TABLE IF NOT EXISTS employee_identities (
 user_id TEXT PRIMARY KEY,
 open_id TEXT UNIQUE,
 union_id TEXT,
 updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- New rule: managerial score 30% + completed peer average 70%.
-- Legacy published snapshots stay in performance_results without being rewritten.
CREATE TABLE IF NOT EXISTS monthly_manager_scores (
 month TEXT NOT NULL, employee_user_id TEXT NOT NULL, evaluator_user_id TEXT NOT NULL,
 score REAL NOT NULL CHECK(score>=0 AND score<=100), comment TEXT NOT NULL CHECK(length(trim(comment))>0),
 snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT(datetime('now')),
 PRIMARY KEY(month,employee_user_id,evaluator_user_id)
);
CREATE TABLE IF NOT EXISTS monthly_weighted_results (
 month TEXT NOT NULL, employee_user_id TEXT NOT NULL, employee_name TEXT NOT NULL,
 kind TEXT NOT NULL DEFAULT 'collaboration' CHECK(kind='collaboration'),
 result_json TEXT NOT NULL, evidence_json TEXT NOT NULL, confirmed_by TEXT NOT NULL,
 confirmed_at TEXT NOT NULL, PRIMARY KEY(month,employee_user_id,kind)
);
CREATE TRIGGER IF NOT EXISTS monthly_manager_scores_no_update BEFORE UPDATE ON monthly_manager_scores BEGIN SELECT RAISE(ABORT,'result_locked'); END;
CREATE TRIGGER IF NOT EXISTS monthly_manager_scores_no_delete BEFORE DELETE ON monthly_manager_scores BEGIN SELECT RAISE(ABORT,'result_locked'); END;
CREATE TRIGGER IF NOT EXISTS monthly_weighted_results_no_update BEFORE UPDATE ON monthly_weighted_results BEGIN SELECT RAISE(ABORT,'result_locked'); END;
CREATE TRIGGER IF NOT EXISTS monthly_weighted_results_no_delete BEFORE DELETE ON monthly_weighted_results BEGIN SELECT RAISE(ABORT,'result_locked'); END;
CREATE TRIGGER IF NOT EXISTS monthly_manager_scores_after_publication BEFORE INSERT ON monthly_manager_scores
WHEN EXISTS(SELECT 1 FROM monthly_weighted_results WHERE month=NEW.month AND employee_user_id=NEW.employee_user_id)
BEGIN SELECT RAISE(ABORT,'result_locked'); END;
CREATE TRIGGER IF NOT EXISTS weighted_response_insert_lock BEFORE INSERT ON scoring360_responses
WHEN EXISTS(SELECT 1 FROM monthly_weighted_results p JOIN scoring360_cycles c ON substr(c.start_date,1,7)=p.month JOIN scoring360_assignments a ON a.id=NEW.assignment_id WHERE c.id=NEW.cycle_id AND a.evaluee_user_id=p.employee_user_id)
BEGIN SELECT RAISE(ABORT,'result_locked'); END;
CREATE TRIGGER IF NOT EXISTS weighted_response_update_lock BEFORE UPDATE ON scoring360_responses
WHEN EXISTS(SELECT 1 FROM monthly_weighted_results p JOIN scoring360_cycles c ON substr(c.start_date,1,7)=p.month JOIN scoring360_assignments a ON a.id IN(OLD.assignment_id,NEW.assignment_id) WHERE c.id IN(OLD.cycle_id,NEW.cycle_id) AND a.evaluee_user_id=p.employee_user_id)
BEGIN SELECT RAISE(ABORT,'result_locked'); END;
CREATE TRIGGER IF NOT EXISTS weighted_response_delete_lock BEFORE DELETE ON scoring360_responses
WHEN EXISTS(SELECT 1 FROM monthly_weighted_results p JOIN scoring360_cycles c ON substr(c.start_date,1,7)=p.month JOIN scoring360_assignments a ON a.id=OLD.assignment_id WHERE c.id=OLD.cycle_id AND a.evaluee_user_id=p.employee_user_id)
BEGIN SELECT RAISE(ABORT,'result_locked'); END;
CREATE TRIGGER IF NOT EXISTS weighted_assignment_insert_lock BEFORE INSERT ON scoring360_assignments
WHEN EXISTS(SELECT 1 FROM monthly_weighted_results p JOIN scoring360_cycles c ON substr(c.start_date,1,7)=p.month WHERE c.id=NEW.cycle_id AND p.employee_user_id=NEW.evaluee_user_id)
BEGIN SELECT RAISE(ABORT,'result_locked'); END;
CREATE TRIGGER IF NOT EXISTS weighted_assignment_update_lock BEFORE UPDATE ON scoring360_assignments
WHEN EXISTS(SELECT 1 FROM monthly_weighted_results p JOIN scoring360_cycles c ON substr(c.start_date,1,7)=p.month WHERE (c.id=NEW.cycle_id AND p.employee_user_id=NEW.evaluee_user_id) OR (c.id=OLD.cycle_id AND p.employee_user_id=OLD.evaluee_user_id))
BEGIN SELECT RAISE(ABORT,'result_locked'); END;
CREATE TRIGGER IF NOT EXISTS weighted_assignment_delete_lock BEFORE DELETE ON scoring360_assignments
WHEN EXISTS(SELECT 1 FROM monthly_weighted_results p JOIN scoring360_cycles c ON substr(c.start_date,1,7)=p.month WHERE c.id=OLD.cycle_id AND p.employee_user_id=OLD.evaluee_user_id)
BEGIN SELECT RAISE(ABORT,'result_locked'); END;
CREATE TRIGGER IF NOT EXISTS weighted_cycle_update_lock BEFORE UPDATE OF id,start_date,end_date ON scoring360_cycles
WHEN EXISTS(SELECT 1 FROM monthly_weighted_results WHERE month=substr(OLD.start_date,1,7))
BEGIN SELECT RAISE(ABORT,'result_locked'); END;
CREATE TRIGGER IF NOT EXISTS weighted_cycle_delete_lock BEFORE DELETE ON scoring360_cycles
WHEN EXISTS(SELECT 1 FROM monthly_weighted_results WHERE month=substr(OLD.start_date,1,7))
BEGIN SELECT RAISE(ABORT,'result_locked'); END;
CREATE TRIGGER IF NOT EXISTS weighted_result_validation BEFORE INSERT ON monthly_weighted_results
WHEN
 NOT EXISTS(SELECT 1 FROM scoring360_assignments a JOIN scoring360_cycles c ON c.id=a.cycle_id WHERE substr(c.start_date,1,7)=NEW.month AND a.evaluee_user_id=NEW.employee_user_id AND COALESCE(a.status,'active')='active')
 OR EXISTS(SELECT 1 FROM scoring360_assignments a JOIN scoring360_cycles c ON c.id=a.cycle_id LEFT JOIN scoring360_responses r ON r.assignment_id=a.id WHERE substr(c.start_date,1,7)=NEW.month AND a.evaluee_user_id=NEW.employee_user_id AND (COALESCE(a.status,'active')='active' OR r.id IS NOT NULL) AND (r.id IS NULL OR trim(COALESCE(r.comment,''))=''))
 OR COALESCE(json_array_length(NEW.evidence_json,'$.managerProgress.expectedIds'),0)=0
 OR (CASE json_extract(NEW.evidence_json,'$.managerProgress.kind') WHEN 'boss' THEN (SELECT count(*) FROM department_leader_scores WHERE month=NEW.month AND leader_user_id=NEW.employee_user_id AND department_id IN(SELECT value FROM json_each(NEW.evidence_json,'$.managerProgress.expectedIds'))) ELSE (SELECT count(*) FROM monthly_manager_scores WHERE month=NEW.month AND employee_user_id=NEW.employee_user_id AND evaluator_user_id IN(SELECT value FROM json_each(NEW.evidence_json,'$.managerProgress.expectedIds'))) END) != json_array_length(NEW.evidence_json,'$.managerProgress.expectedIds')
 OR ABS(COALESCE(json_extract(NEW.result_json,'$.peerScore'),-1000)-(SELECT ROUND(AVG(r.score),1) FROM scoring360_assignments a JOIN scoring360_cycles c ON c.id=a.cycle_id JOIN scoring360_responses r ON r.assignment_id=a.id WHERE substr(c.start_date,1,7)=NEW.month AND a.evaluee_user_id=NEW.employee_user_id))>0.001
 OR ABS(COALESCE(json_extract(NEW.result_json,'$.managerScore'),-1000)-(CASE json_extract(NEW.evidence_json,'$.managerProgress.kind') WHEN 'boss' THEN (SELECT ROUND(AVG(score),1) FROM department_leader_scores WHERE month=NEW.month AND leader_user_id=NEW.employee_user_id AND department_id IN(SELECT value FROM json_each(NEW.evidence_json,'$.managerProgress.expectedIds'))) ELSE (SELECT ROUND(AVG(score),1) FROM monthly_manager_scores WHERE month=NEW.month AND employee_user_id=NEW.employee_user_id AND evaluator_user_id IN(SELECT value FROM json_each(NEW.evidence_json,'$.managerProgress.expectedIds'))) END))>0.001
 OR ABS(COALESCE(json_extract(NEW.result_json,'$.score'),-1000)-ROUND(json_extract(NEW.result_json,'$.peerScore')*0.7+json_extract(NEW.result_json,'$.managerScore')*0.3,1))>0.001
BEGIN SELECT RAISE(ABORT,'weighted_scoring_incomplete_or_changed'); END;
