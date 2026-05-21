import Database from "better-sqlite3";
import { DatabaseConfig, EmbedJobStatus, RetryConfig } from "./constants.js";

/**
 * Cria as tabelas da migração de embedados, se não existirem.
 * @param {Database} db
 */
function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS embed_posts (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      wp_post_id  INTEGER NOT NULL UNIQUE,
      title       TEXT,
      post_url    TEXT,
      post_date   TEXT,
      status      TEXT NOT NULL DEFAULT 'queued',
      attempts    INTEGER NOT NULL DEFAULT 0,
      video_count INTEGER NOT NULL DEFAULT 0,
      error       TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_embed_posts_status ON embed_posts(status);

    CREATE TABLE IF NOT EXISTS video_map (
      vimeo_id       TEXT PRIMARY KEY,
      youtube_id     TEXT NOT NULL,
      youtube_url    TEXT NOT NULL,
      vimeo_name     TEXT,
      source_post_id INTEGER,
      created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

/**
 * Verifica se a tabela `jobs` (migração da seção Play) existe no banco.
 * @param {Database} db
 * @returns {boolean}
 */
function jobsTableExists(db) {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='jobs'")
    .get();
  return Boolean(row);
}

/**
 * Cria o acesso ao banco da migração de vídeos embedados.
 * @param {string} dbPath - Caminho do arquivo SQLite
 * @param {number} [maxAttempts] - Máximo de tentativas por matéria
 * @returns {Object} API do banco
 */
export function createEmbedDb(dbPath, maxAttempts = RetryConfig.MAX_ATTEMPTS) {
  const db = new Database(dbPath);
  db.pragma(`journal_mode = ${DatabaseConfig.JOURNAL_MODE}`);
  db.pragma(`busy_timeout = ${DatabaseConfig.BUSY_TIMEOUT_MS}`);
  initSchema(db);

  return {
    /** Handle bruto do better-sqlite3. Uso interno/testes — não usar por chamadores de produção. */
    db,

    /**
     * Insere uma matéria na fila. Ignora se já existir (não re-enfileira).
     * @returns {boolean} true se inseriu, false se já existia
     */
    upsertEmbedPost({ wp_post_id, title, post_url, post_date, video_count }) {
      const r = db
        .prepare(
          `INSERT INTO embed_posts (wp_post_id, title, post_url, post_date, video_count, status)
           VALUES (?, ?, ?, ?, ?, '${EmbedJobStatus.QUEUED}')
           ON CONFLICT(wp_post_id) DO NOTHING`
        )
        .run(wp_post_id, title || null, post_url || null, post_date || null, video_count || 0);
      return r.changes > 0;
    },

    /**
     * Próxima matéria a processar (queued/failed, mais antiga primeiro).
     * @returns {Object|null}
     */
    nextEmbedPost() {
      return (
        db
          .prepare(
            `SELECT * FROM embed_posts
             WHERE status IN ('${EmbedJobStatus.QUEUED}','${EmbedJobStatus.FAILED}')
               AND attempts < ?
             ORDER BY post_date ASC, id ASC
             LIMIT 1`
          )
          .get(maxAttempts) || null
      );
    },

    /**
     * Todas as matérias pendentes (queued/failed), mais antiga primeiro.
     * @returns {Object[]}
     */
    pendingEmbedPosts() {
      return db
        .prepare(
          `SELECT * FROM embed_posts
           WHERE status IN ('${EmbedJobStatus.QUEUED}','${EmbedJobStatus.FAILED}')
             AND attempts < ?
           ORDER BY post_date ASC, id ASC`
        )
        .all(maxAttempts);
    },

    /**
     * Atualiza status e campos extras de uma matéria.
     * @param {number} id
     * @param {string} status
     * @param {Object} [patch]
     */
    setEmbedPostStatus(id, status, patch = {}) {
      const fields = { ...patch, status, updated_at: new Date().toISOString() };
      const cols = Object.keys(fields);
      const setSql = cols.map((c) => `${c} = ?`).join(", ");
      db.prepare(`UPDATE embed_posts SET ${setSql} WHERE id = ?`).run(
        ...cols.map((c) => fields[c]),
        id
      );
    },

    /** Incrementa o contador de tentativas de uma matéria. */
    incEmbedPostAttempts(id) {
      db.prepare(
        "UPDATE embed_posts SET attempts = attempts + 1, updated_at = ? WHERE id = ?"
      ).run(new Date().toISOString(), id);
    },

    /**
     * Contagem de matérias por status.
     * @returns {Object}
     */
    embedStats() {
      const rows = db
        .prepare("SELECT status, COUNT(*) AS n FROM embed_posts GROUP BY status")
        .all();
      return Object.fromEntries(rows.map((r) => [r.status, r.n]));
    },

    /**
     * Resolve um vimeo_id para um vídeo já no YouTube.
     * Procura no video_map (esta migração) e na tabela jobs (migração Play).
     * @param {string} vimeoId
     * @returns {{youtubeId: string, youtubeUrl: string, source: string}|null}
     */
    resolveYoutubeId(vimeoId) {
      const fromMap = db
        .prepare("SELECT youtube_id, youtube_url FROM video_map WHERE vimeo_id = ?")
        .get(String(vimeoId));
      if (fromMap) {
        return {
          youtubeId: fromMap.youtube_id,
          youtubeUrl: fromMap.youtube_url,
          source: "reuse:embed",
        };
      }
      if (jobsTableExists(db)) {
        const fromJobs = db
          .prepare(
            `SELECT youtube_id, youtube_url FROM jobs
             WHERE vimeo_id = ? AND youtube_url IS NOT NULL AND youtube_url != ''
             LIMIT 1`
          )
          .get(String(vimeoId));
        if (fromJobs) {
          return {
            youtubeId: fromJobs.youtube_id,
            youtubeUrl: fromJobs.youtube_url,
            source: "reuse:play",
          };
        }
      }
      return null;
    },

    /**
     * Registra um vídeo migrado no video_map (ledger de dedup).
     * Ignora se o vimeo_id já estiver registrado.
     */
    recordVideoMap({ vimeo_id, youtube_id, youtube_url, vimeo_name, source_post_id }) {
      db.prepare(
        `INSERT INTO video_map (vimeo_id, youtube_id, youtube_url, vimeo_name, source_post_id)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(vimeo_id) DO NOTHING`
      ).run(
        String(vimeo_id),
        youtube_id,
        youtube_url,
        vimeo_name || null,
        source_post_id || null
      );
    },

    /** Fecha a conexão com o banco. */
    close() {
      db.close();
    },
  };
}
