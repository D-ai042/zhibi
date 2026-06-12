-- Novel Workbench SQLite schema (MVP)

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'ideation',
  framework_locked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS volumes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS chapters (
  id TEXT PRIMARY KEY,
  volume_id TEXT NOT NULL REFERENCES volumes(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'beat_ready',
  word_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS timeline_nodes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT DEFAULT '',
  volume_id TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_locked INTEGER NOT NULL DEFAULT 0,
  layout_y REAL NOT NULL DEFAULT 0,
  must_achieve_json TEXT DEFAULT '[]',
  character_ids_json TEXT DEFAULT '[]',
  linked_chapter_id TEXT
);

CREATE TABLE IF NOT EXISTS plot_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  line_type TEXT NOT NULL,
  title TEXT NOT NULL,
  chapter_start INTEGER NOT NULL,
  chapter_end INTEGER NOT NULL,
  reader_knowledge TEXT NOT NULL,
  truth_content TEXT DEFAULT '',
  plant_method TEXT DEFAULT '',
  convergence_chapter INTEGER,
  is_locked INTEGER NOT NULL DEFAULT 0,
  character_ids_json TEXT DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  faction TEXT DEFAULT '',
  weight INTEGER NOT NULL DEFAULT 5,
  desire TEXT DEFAULT '',
  fear TEXT DEFAULT '',
  flaw TEXT DEFAULT '',
  arc TEXT DEFAULT '',
  voice_style TEXT DEFAULT '',
  ending_node_id TEXT,
  avatar_path TEXT,
  layout_x REAL NOT NULL DEFAULT 0,
  layout_y REAL NOT NULL DEFAULT 0,
  is_locked INTEGER NOT NULL DEFAULT 0,
  snapshots_json TEXT DEFAULT '[]',
  gender TEXT DEFAULT '',
  age TEXT DEFAULT '',
  race TEXT DEFAULT '',
  appearance TEXT DEFAULT '',
  personality TEXT DEFAULT '',
  background TEXT DEFAULT '',
  ability TEXT DEFAULT '',
  style TEXT DEFAULT '',
  interests TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS relationship_edges (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  strength INTEGER NOT NULL DEFAULT 5,
  is_secret INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS beat_cards (
  id TEXT PRIMARY KEY,
  chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  column_type TEXT NOT NULL,
  content TEXT DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS chapter_contents (
  chapter_id TEXT PRIMARY KEY REFERENCES chapters(id) ON DELETE CASCADE,
  body_json TEXT NOT NULL DEFAULT '{}',
  body_html TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chapter_content_versions (
  id TEXT PRIMARY KEY,
  chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  body_json TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS locked_fields (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  field_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_revision_logs (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  prompt_summary TEXT,
  response_summary TEXT,
  accepted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS world_terms (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  term_type TEXT NOT NULL DEFAULT 'rule',
  title TEXT NOT NULL,
  one_liner TEXT DEFAULT '',
  detail TEXT DEFAULT '',
  ring_level INTEGER NOT NULL DEFAULT 1,
  forbidden_json TEXT DEFAULT '[]',
  is_locked INTEGER NOT NULL DEFAULT 0,
  layout_x REAL NOT NULL DEFAULT 0,
  layout_y REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
