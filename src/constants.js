/**
 * Constantes centralizadas do projeto
 * Facilita manutenção e evita magic numbers espalhados
 */

/**
 * Status possíveis de um job no sistema
 * @readonly
 * @enum {string}
 */
export const JobStatus = {
  QUEUED: "queued",
  DOWNLOADING: "downloading",
  UPLOADING: "uploading",
  UPDATING_WP: "updating_wp",
  DONE: "done",
  FAILED: "failed",
};

/**
 * Configurações de retry e rate limiting
 * @readonly
 */
export const RetryConfig = {
  /** Número máximo de tentativas por job */
  MAX_ATTEMPTS: 5,
  /** Delay base entre retries (ms) */
  BASE_DELAY_MS: 1000,
  /** Fator de multiplicação para backoff exponencial */
  BACKOFF_FACTOR: 2,
  /** Delay máximo entre retries (ms) */
  MAX_DELAY_MS: 30000,
};

/**
 * Configurações de quota da YouTube API
 * @readonly
 */
export const YouTubeQuota = {
  /** Custo em unidades para upload de vídeo */
  UPLOAD_COST: 1600,
  /** Custo em unidades para verificação de status */
  STATUS_CHECK_COST: 1,
  /** Quota padrão Always Free */
  DEFAULT_DAILY_QUOTA: 10000,
  /** Buffer de segurança (não usar 100% da quota) */
  SAFETY_BUFFER_PERCENT: 0.95,
};

/**
 * Configurações de download
 * @readonly
 */
export const DownloadConfig = {
  /** Intervalo de log de progresso (ms) */
  PROGRESS_LOG_INTERVAL_MS: 2000,
  /** Timeout de conexão (ms) */
  CONNECTION_TIMEOUT_MS: 30000,
  /** Timeout de download completo (ms) - 10 minutos */
  DOWNLOAD_TIMEOUT_MS: 600000,
};

/**
 * Configurações de upload
 * @readonly
 */
export const UploadConfig = {
  /** Intervalo de log de progresso (ms) */
  PROGRESS_LOG_INTERVAL_MS: 2000,
  /** Categoria padrão do YouTube (22 = People & Blogs) */
  DEFAULT_CATEGORY_ID: "22",
  /** Status de privacidade padrão */
  DEFAULT_PRIVACY_STATUS: "unlisted",
  /** Se o vídeo é "made for kids" */
  DEFAULT_MADE_FOR_KIDS: false,
};

/**
 * Configurações de banco de dados
 * @readonly
 */
export const DatabaseConfig = {
  /** Modo journal para SQLite */
  JOURNAL_MODE: "WAL",
  /** Busy timeout (ms) */
  BUSY_TIMEOUT_MS: 5000,
};

/**
 * Configurações de batch e concorrência
 * @readonly
 */
export const WorkerConfig = {
  /** Tamanho padrão do batch de posts WordPress */
  DEFAULT_BATCH_SIZE: 20,
  /** Concorrência padrão de workers */
  DEFAULT_CONCURRENCY: 1,
  /** Páginas máximas a buscar (0 = ilimitado) */
  DEFAULT_MAX_PAGES: 0,
};

/**
 * Formatos de data/hora
 * @readonly
 */
export const DateFormats = {
  /** ISO 8601 completo */
  ISO: "YYYY-MM-DDTHH:mm:ss.sssZ",
  /** Para display */
  DISPLAY: "DD/MM/YYYY HH:mm:ss",
  /** Para filenames */
  FILENAME: "YYYYMMDD_HHmmss",
};

/**
 * Mensagens de erro comuns
 * @readonly
 */
export const ErrorMessages = {
  VIMEO_NO_DOWNLOAD_LINKS: "Vimeo video has no download/progressive links available (check permissions)",
  YOUTUBE_NO_VIDEO_ID: "YouTube upload succeeded but no video id returned",
  WP_UNEXPECTED_RESPONSE: "Unexpected response from WordPress endpoint",
  QUOTA_EXCEEDED: "YouTube API quota exceeded for today",
  INVALID_VIMEO_URL: "Invalid Vimeo URL format",
  FILE_NOT_FOUND: "Local file not found",
  UPLOAD_INTERRUPTED: "Upload was interrupted and could not be resumed",
};

/**
 * Headers HTTP comuns
 * @readonly
 */
export const HttpHeaders = {
  CONTENT_TYPE_JSON: "application/json",
  AUTHORIZATION_BEARER: (token) => `Bearer ${token}`,
  AUTHORIZATION_BASIC: (user, pass) => {
    const encoded = Buffer.from(`${user}:${pass}`).toString("base64");
    return `Basic ${encoded}`;
  },
};

/**
 * Regex patterns
 * @readonly
 */
export const Patterns = {
  /** Extrair ID do Vimeo de URL */
  VIMEO_ID: /vimeo\.com\/(\d+)/,
  /** ID do YouTube em URL youtu.be */
  YOUTUBE_SHORT_URL: /youtu\.be\/([a-zA-Z0-9_-]+)/,
  /** ID do YouTube em URL youtube.com/watch */
  YOUTUBE_WATCH_URL: /[?&]v=([a-zA-Z0-9_-]+)/,
};
