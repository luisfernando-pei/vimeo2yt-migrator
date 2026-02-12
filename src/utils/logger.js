import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

/**
 * Níveis de log disponíveis
 * @readonly
 * @enum {string}
 */
export const LogLevel = {
  DEBUG: "debug",
  INFO: "info",
  WARN: "warn",
  ERROR: "error",
};

/**
 * Cores para cada nível de log no console
 * @readonly
 * @enum {string}
 */
const LogColors = {
  debug: "\x1b[36m", // Cyan
  info: "\x1b[32m", // Green
  warn: "\x1b[33m", // Yellow
  error: "\x1b[31m", // Red
  reset: "\x1b[0m",
};

/**
 * Logger centralizado com suporte a:
 * - Níveis de log (debug, info, warn, error)
 * - Escrita em arquivo
 * - Saída colorida no console
 * - Formato JSON opcional para produção
 */
class Logger {
  /**
   * @param {Object} options
   * @param {string} options.logFile - Caminho do arquivo de log
   * @param {string} options.level - Nível mínimo de log
   * @param {boolean} options.json - Se true, formata como JSON
   */
  constructor(options = {}) {
    this.logFile = options.logFile || config.logFile || "logs/app.log";
    this.level = options.level || process.env.LOG_LEVEL || "info";
    this.json = options.json || process.env.LOG_FORMAT === "json";
    this.levels = ["debug", "info", "warn", "error"];
    
    // Garantir que o diretório de logs existe
    const logDir = path.dirname(this.logFile);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  }

  /**
   * Verifica se o nível deve ser logado
   * @private
   * @param {string} level
   * @returns {boolean}
   */
  _shouldLog(level) {
    const minIndex = this.levels.indexOf(this.level);
    const currentIndex = this.levels.indexOf(level);
    return currentIndex >= minIndex;
  }

  /**
   * Formata a mensagem para saída
   * @private
   * @param {string} level
   * @param {string} message
   * @param {Object} meta
   * @returns {string}
   */
  _format(level, message, meta = {}) {
    const timestamp = new Date().toISOString();
    
    if (this.json) {
      return JSON.stringify({
        timestamp,
        level,
        message,
        ...meta,
      });
    }
    
    let formatted = message;
    if (Object.keys(meta).length > 0) {
      formatted += ` | ${JSON.stringify(meta)}`;
    }
    
    return `[${timestamp}] [${level.toUpperCase()}] ${formatted}`;
  }

  /**
   * Escreve no arquivo e console
   * @private
   * @param {string} level
   * @param {string} message
   * @param {Object} meta
   */
  _write(level, message, meta = {}) {
    if (!this._shouldLog(level)) return;

    const formatted = this._format(level, message, meta);
    
    // Escrever no arquivo (síncrono para garantir ordem)
    try {
      fs.appendFileSync(this.logFile, formatted + "\n");
    } catch (err) {
      console.error(`Failed to write to log file: ${err.message}`);
    }

    // Console com cores
    const color = LogColors[level] || LogColors.reset;
    console.log(`${color}${formatted}${LogColors.reset}`);
  }

  /**
   * Log de debug
   * @param {string} message
   * @param {Object} meta
   */
  debug(message, meta = {}) {
    this._write("debug", message, meta);
  }

  /**
   * Log de info
   * @param {string} message
   * @param {Object} meta
   */
  info(message, meta = {}) {
    this._write("info", message, meta);
  }

  /**
   * Log de warning
   * @param {string} message
   * @param {Object} meta
   */
  warn(message, meta = {}) {
    this._write("warn", message, meta);
  }

  /**
   * Log de erro
   * @param {string} message
   * @param {Object} meta
   */
  error(message, meta = {}) {
    this._write("error", message, meta);
  }

  /**
   * Log de progresso (para downloads/uploads)
   * @param {string} operation - Nome da operação (ex: "DL", "UP")
   * @param {string} id - ID do vídeo
   * @param {Object} stats - Estatísticas { bytes, total, mbps, eta }
   */
  progress(operation, id, stats) {
    if (!this._shouldLog("info")) return;
    
    const { bytes, total, mbps, eta } = stats;
    const mb = (bytes / 1024 / 1024).toFixed(1);
    const totalMb = total ? (total / 1024 / 1024).toFixed(1) : "?";
    const pct = total ? ((bytes / total) * 100).toFixed(1) : "?";
    
    const msg = `${operation} ${id}: ${mb}/${totalMb} MB (${pct}%) @ ${mbps.toFixed(2)} MB/s ETA ${eta}`;
    process.stdout.write(`\r${msg}      `);
  }

  /**
   * Finaliza linha de progresso
   */
  progressEnd() {
    process.stdout.write("\n");
  }
}

// Instância singleton
let instance = null;

/**
 * Obtém instância do logger (singleton)
 * @returns {Logger}
 */
export function getLogger() {
  if (!instance) {
    instance = new Logger();
  }
  return instance;
}

/**
 * Cria novo logger com configurações específicas
 * @param {Object} options
 * @returns {Logger}
 */
export function createLogger(options) {
  return new Logger(options);
}

// Exportar instância padrão
export const logger = getLogger();
