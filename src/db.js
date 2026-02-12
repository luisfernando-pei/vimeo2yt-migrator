import Database from "better-sqlite3";
import { config } from "./config.js";
import { logger } from "./utils/logger.js";
import { DatabaseConfig, JobStatus } from "./constants.js";

let db;

/**
 * Obtém instância do banco de dados (singleton)
 * Inicializa com WAL mode para melhor concorrência
 * @returns {Database} Instância do better-sqlite3
 */
export function getDb() {
  if (db) return db;
  db = new Database(config.dbPath);
  db.pragma(`journal_mode = ${DatabaseConfig.JOURNAL_MODE}`);
  db.pragma(`busy_timeout = ${DatabaseConfig.BUSY_TIMEOUT_MS}`);
  init(db);
  logger.debug("Database initialized", { path: config.dbPath });
  return db;
}

/**
 * Inicializa schema do banco de dados
 * @private
 * @param {Database} db - Instância do banco
 */
function init(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wp_post_id INTEGER NOT NULL,
      vimeo_url TEXT NOT NULL,
      vimeo_id TEXT NOT NULL,
      title TEXT,
      content TEXT,
      tags TEXT,
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
  
  // Migration: add new columns if they don't exist (for existing databases)
  try {
    db.exec(`ALTER TABLE jobs ADD COLUMN title TEXT`);
  } catch (e) {
    // Column already exists, ignore
  }
  try {
    db.exec(`ALTER TABLE jobs ADD COLUMN content TEXT`);
  } catch (e) {
    // Column already exists, ignore
  }
  try {
    db.exec(`ALTER TABLE jobs ADD COLUMN tags TEXT`);
  } catch (e) {
    // Column already exists, ignore
  }
}



/**
 * Insere ou ignora job na fila
 * Usa ON CONFLICT para evitar duplicatas (wp_post_id + vimeo_id)
 * @param {Object} params
 * @param {number} params.wp_post_id - ID do post WordPress
 * @param {string} params.vimeo_url - URL do vídeo Vimeo
 * @param {string} params.vimeo_id - ID do vídeo Vimeo
 * @param {string} [params.title] - Título do post WordPress
 * @param {string} [params.content] - Conteúdo do post WordPress
 * @param {string[]} [params.tags] - Tags do post WordPress
 * @returns {boolean} true se inseriu novo job, false se já existia
 */
export function upsertJob({ wp_post_id, vimeo_url, vimeo_id, title, content, tags }) {
  const db = getDb();
  
  // Converte array de tags para string JSON
  const tagsJson = tags && Array.isArray(tags) ? JSON.stringify(tags) : null;
  
  const stmt = db.prepare(`
    INSERT INTO jobs (wp_post_id, vimeo_url, vimeo_id, title, content, tags, status)
    VALUES (?, ?, ?, ?, ?, ?, '${JobStatus.QUEUED}')
    ON CONFLICT(wp_post_id, vimeo_id) DO NOTHING
  `);
  const result = stmt.run(wp_post_id, vimeo_url, vimeo_id, title || null, content || null, tagsJson);
  if (result.changes > 0) {
    logger.debug(`Job inserted`, { wp_post_id, vimeo_id, title });
    return true;
  }
  return false;
}

/**
 * Busca próximo job disponível para processamento
 * Prioriza jobs mais antigos (updated_at ASC)
 * @returns {Object|null} Job encontrado ou null se vazio
 */
export function nextJob() {
  const db = getDb();
  const row = db.prepare(`
    SELECT * FROM jobs
    WHERE status IN ('${JobStatus.QUEUED}','${JobStatus.FAILED}')
      AND attempts < ?
    ORDER BY updated_at ASC
    LIMIT 1
  `).get(config.worker.maxAttempts);
  
  if (row) {
    logger.debug(`Next job selected`, { jobId: row.id, vimeoId: row.vimeo_id });
  }
  
  return row || null;
}

/**
 * Atualiza status e campos adicionais de um job
 * @param {number} id - ID do job
 * @param {string} status - Novo status (use JobStatus constants)
 * @param {Object} [patch={}] - Campos adicionais para atualizar
 */
export function setStatus(id, status, patch = {}) {
  const db = getDb();
  const fields = { ...patch, status, updated_at: new Date().toISOString() };
  const cols = Object.keys(fields);
  const setSql = cols.map((c) => `${c} = ?`).join(", ");
  const values = cols.map((c) => fields[c]);
  db.prepare(`UPDATE jobs SET ${setSql} WHERE id = ?`).run(...values, id);
  logger.debug(`Job status updated`, { jobId: id, status });
}

/**
 * Incrementa contador de tentativas do job
 * @param {number} id - ID do job
 */
export function incAttempts(id) {
  const db = getDb();
  db.prepare(`
    UPDATE jobs
    SET attempts = attempts + 1, updated_at = ?
    WHERE id = ?
  `).run(new Date().toISOString(), id);
  logger.debug(`Job attempt incremented`, { jobId: id });
}

/**
 * Retorna estatísticas de jobs por status
 * @returns {Object} Contagem por status { queued: 10, done: 5, ... }
 */
export function stats() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT status, COUNT(*) as n FROM jobs GROUP BY status
  `).all();
  const out = Object.fromEntries(rows.map(r => [r.status, r.n]));
  logger.debug(`Stats retrieved`, out);
  return out;
}

// Quota tracking functions
export function getDailyQuotaStatus() {
  const db = getDb();
  
  // Ensure row exists
  db.prepare(`INSERT OR IGNORE INTO quota_tracking (id) VALUES (1)`).run();
  
  const row = db.prepare(`
    SELECT upload_count, quota_used, date, updated_at 
    FROM quota_tracking 
    WHERE id = 1
  `).get();
  
  // Check if it's a new day, reset if needed
  const today = new Date().toISOString().split('T')[0];
  if (row && row.date !== today) {
    // Reset for new day
    db.prepare(`
      UPDATE quota_tracking 
      SET upload_count = 0,
          quota_used = 0,
          date = date('now'),
          updated_at = datetime('now')
      WHERE id = 1
    `).run();
    return { upload_count: 0, quota_used: 0, date: today };
  }
  
  return row || { upload_count: 0, quota_used: 0, date: today };
}

export function incrementUploadCount(uploadCost = 1600) {
  const db = getDb();
  
  // Ensure row exists before incrementing
  db.prepare(`INSERT OR IGNORE INTO quota_tracking (id) VALUES (1)`).run();
  
  db.prepare(`
    UPDATE quota_tracking 
    SET upload_count = upload_count + 1,
        quota_used = quota_used + ?,
        date = date('now'),
        updated_at = datetime('now')
    WHERE id = 1
  `).run(uploadCost);
}

export function resetDailyQuota() {
  const db = getDb();
  
  db.prepare(`
    UPDATE quota_tracking 
    SET upload_count = 0,
        quota_used = 0,
        date = date('now'),
        updated_at = datetime('now')
    WHERE id = 1
  `).run();
}

export function canUploadToday(maxUploadsPerDay) {
  const status = getDailyQuotaStatus();
  return status.upload_count < maxUploadsPerDay;
}

export function getQuotaStats() {
  const db = getDb();
  const status = getDailyQuotaStatus();
  const remaining = Math.max(0, Math.floor((10000 - status.quota_used) / 1600));
  
  return {
    ...status,
    remaining_uploads: remaining,
    quota_percentage: Math.round((status.quota_used / 10000) * 100)
  };
}
