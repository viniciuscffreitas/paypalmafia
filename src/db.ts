import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { createLogger } from './core/logger';

const logger = createLogger('db');

export function initDatabase(dbPath: string): Database.Database {
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  runMigrations(db);

  logger.info(`Database initialized at ${dbPath}`);
  return db;
}

function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const migrations: { name: string; sql: string }[] = [
    {
      name: '001_projects',
      sql: `
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          discord_category_id TEXT NOT NULL,
          github_repo TEXT,
          linear_team_id TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          archived_at DATETIME
        );
      `,
    },
    {
      name: '002_links',
      sql: `
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
      `,
    },
    {
      name: '003_metrics',
      sql: `
        CREATE TABLE IF NOT EXISTS metrics_snapshots (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id TEXT REFERENCES projects(id),
          date DATE NOT NULL,
          commits_count INTEGER DEFAULT 0,
          issues_closed INTEGER DEFAULT 0,
          prs_merged INTEGER DEFAULT 0,
          UNIQUE(project_id, date)
        );
      `,
    },
    {
      name: '004_standups',
      sql: `
        CREATE TABLE IF NOT EXISTS standups (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id TEXT REFERENCES projects(id),
          user_id TEXT NOT NULL,
          auto_summary TEXT,
          manual_notes TEXT,
          blockers TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `,
    },
    {
      name: '005_deployments',
      sql: `
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
      `,
    },
    {
      name: '006_leads',
      sql: `
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
      `,
    },
  ];

  const applied = new Set(
    db.prepare('SELECT name FROM migrations').all().map((r: any) => r.name)
  );

  const insert = db.prepare('INSERT INTO migrations (name) VALUES (?)');

  for (const migration of migrations) {
    if (!applied.has(migration.name)) {
      db.exec(migration.sql);
      insert.run(migration.name);
      logger.info(`Applied migration: ${migration.name}`);
    }
  }
}
