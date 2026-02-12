import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

/**
 * Carrega variáveis de ambiente do arquivo .env apropriado
 * baseado no NODE_ENV (qa ou prod)
 */
const nodeEnv = process.env.NODE_ENV || "qa";
const envFile = nodeEnv === "prod" ? ".env.prod" : ".env.qa";

dotenv.config({ path: envFile });

/**
 * Valida e retorna variável de ambiente obrigatória
 * @param {string} name - Nome da variável
 * @returns {string} Valor da variável
 * @throws {Error} Se a variável não estiver definida
 */
function must(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name} (from ${envFile})`);
  return v;
}

/**
 * Configuração centralizada do sistema
 * Todas as configurações são carregadas de variáveis de ambiente
 * com valores padrão sensatos
 */
export const config = {
  /** Ambiente da aplicação (qa, prod) */
  appEnv: must("APP_ENV"),
  
  /** Caminho do banco de dados SQLite */
  dbPath: must("DB_PATH"),
  
  /** Diretório temporário para downloads */
  tmpDir: must("TMP_DIR"),
  
  /** Caminho do arquivo de log */
  logFile: must("LOG_FILE"),

  /** Token de API do Vimeo */
  vimeoToken: must("VIMEO_TOKEN"),

  /** Configurações do YouTube */
  yt: {
    clientId: must("YT_CLIENT_ID"),
    clientSecret: must("YT_CLIENT_SECRET"),
    redirectUri: must("YT_REDIRECT_URI"),
    refreshToken: must("YT_REFRESH_TOKEN"),
    privacyStatus: process.env.YT_PRIVACY_STATUS || "unlisted",
  },

  /** Configurações do WordPress */
  wp: {
    appUser: must("WP_APP_USER"),
    appPass: must("WP_APP_PASS"),
    baseUrl: must("WP_BASE_URL").replace(/\/$/, ""),
    migrateToken: must("WP_MIGRATE_TOKEN"),
    qaBasicUser: process.env.QA_BASIC_USER || "",
    qaBasicPass: process.env.QA_BASIC_PASS || "",
    batchSize: Number(process.env.BATCH_SIZE || 20),
    postType: process.env.WP_POST_TYPE || "posts",
    metaKey: process.env.WP_META_KEY || "url_do_youtube",
    queryParam: process.env.WP_QUERY_PARAM || "",
    fetchMaxPages: Number(process.env.FETCH_MAX_PAGES || 0),
  },

  /** Configurações do worker */
  worker: {
    concurrency: Number(process.env.CONCURRENCY || 1),
    cleanupOk: process.env.CLEANUP_OK === "1",
    maxAttempts: Number(process.env.MAX_ATTEMPTS || 5),
    delayBetweenUploadsMs: Number(process.env.DELAY_BETWEEN_UPLOADS_MS || 0),
  },
};

/**
 * Garante que os diretórios necessários existem
 * Cria recursivamente se não existirem
 */
export function ensureDirs() {
  const dirs = [
    path.dirname(config.dbPath),
    config.tmpDir,
    "logs",
    "data"
  ];
  
  for (const p of dirs) {
    if (!fs.existsSync(p)) {
      fs.mkdirSync(p, { recursive: true });
    }
  }
}
