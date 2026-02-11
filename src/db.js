import Database from "better-sqlite3";
import { config } from "./config.js";

let db;

export function getDb() {
  if (db) return db;
  db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");
  init(db);
  return db;
}

function init(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wp_post_id INTEGER NOT NULL,
      vimeo_url TEXT NOT NULL,
      vimeo_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      attempts INTEGER NOT NULL DEFAULT 0,
      local_path TEXT,
      file_size_bytes INTEGER,
      youtube_id TEXT,
      youtube_url TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_unique ON jobs(wp_post_id, vimeo_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
  `);
}

export function upsertJob({ wp_post_id, vimeo_url, vimeo_id }) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO jobs (wp_post_id, vimeo_url, vimeo_id, status)
    VALUES (?, ?, ?, 'queued')
    ON CONFLICT(wp_post_id, vimeo_id) DO NOTHING
  `);
  stmt.run(wp_post_id, vimeo_url, vimeo_id);
}

export function nextJob() {
  const db = getDb();
  const row = db.prepare(`
    SELECT * FROM jobs
    WHERE status IN ('queued','failed')
      AND attempts < ?
    ORDER BY updated_at ASC
    LIMIT 1
  `).get(config.worker.maxAttempts);
  return row || null;
}

export function setStatus(id, status, patch = {}) {
  const db = getDb();
  const fields = { ...patch, status, updated_at: new Date().toISOString() };
  const cols = Object.keys(fields);
  const setSql = cols.map((c) => `${c} = ?`).join(", ");
  const values = cols.map((c) => fields[c]);
  db.prepare(`UPDATE jobs SET ${setSql} WHERE id = ?`).run(...values, id);
}

export function incAttempts(id) {
  const db = getDb();
  db.prepare(`
    UPDATE jobs
    SET attempts = attempts + 1, updated_at = ?
    WHERE id = ?
  `).run(new Date().toISOString(), id);
}

export function stats() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT status, COUNT(*) as n FROM jobs GROUP BY status
  `).all();
  const out = Object.fromEntries(rows.map(r => [r.status, r.n]));
  return out;
}