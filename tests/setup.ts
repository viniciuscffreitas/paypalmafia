import Database from 'better-sqlite3';
import { EventEmitter } from 'events';

export function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      discord_category_id TEXT NOT NULL,
      github_repo TEXT,
      linear_team_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      archived_at DATETIME
    );
    CREATE TABLE IF NOT EXISTS links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT REFERENCES projects(id),
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      description TEXT,
      saved_by TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(project_id, name)
    );
    CREATE TABLE IF NOT EXISTS metrics_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT REFERENCES projects(id),
      date DATE NOT NULL,
      commits_count INTEGER DEFAULT 0,
      issues_closed INTEGER DEFAULT 0,
      prs_merged INTEGER DEFAULT 0,
      UNIQUE(project_id, date)
    );
    CREATE TABLE IF NOT EXISTS standups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT REFERENCES projects(id),
      user_id TEXT NOT NULL,
      auto_summary TEXT,
      manual_notes TEXT,
      blockers TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS deployments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sha TEXT NOT NULL,
      author TEXT,
      version TEXT,
      commit_count INTEGER DEFAULT 0,
      commit_messages TEXT,
      ai_summary TEXT,
      risk_level TEXT,
      deployed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS leads_search_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      query TEXT NOT NULL,
      region TEXT NOT NULL,
      radius_km INTEGER DEFAULT 10,
      min_score INTEGER DEFAULT 5,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      place_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      address TEXT,
      phone TEXT,
      website TEXT,
      google_maps_url TEXT,
      rating REAL,
      review_count INTEGER DEFAULT 0,
      category TEXT,
      region TEXT,
      score INTEGER DEFAULT 0,
      recommended_service TEXT,
      ai_analysis TEXT,
      ai_pitch TEXT,
      status TEXT DEFAULT 'new',
      found_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      contacted_at DATETIME
    );
  `);

  return db;
}

export function createMockClient(): any {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    guilds: { cache: new Map() },
    user: { tag: 'TestBot#0000' },
    login: async () => 'mock-token',
    destroy: () => {},
  });
}

export function createTestContext(db?: Database.Database) {
  const testDb = db || createTestDb();
  return {
    client: createMockClient(),
    db: testDb,
    logger: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    },
    getModule: () => undefined,
  };
}
