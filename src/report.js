// src/report.js
import fs from "node:fs";
import path from "node:path";
import { logger } from "./utils/logger.js";

/**
 * Escapa valor para CSV (RFC 4180)
 * @param {*} v - Valor a ser escapado
 * @returns {string} Valor escapado para CSV
 * @example
 * csvEscape('texto "com" aspas') // '"texto ""com"" aspas"'
 * csvEscape(null) // ''
 */
function csvEscape(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Adiciona linha ao CSV de mapeamento
 * Registra todos os jobs processados para auditoria
 * @param {Object} params
 * @param {string} params.env - Ambiente (qa, prod, dev)
 * @param {number} params.jobId - ID do job no banco
 * @param {number} params.wpPostId - ID do post WordPress
 * @param {string} params.vimeoId - ID do vídeo Vimeo
 * @param {string} params.vimeoUrl - URL do vídeo Vimeo
 * @param {string} params.vimeoTitle - Título do vídeo Vimeo
 * @param {string} params.youtubeId - ID do vídeo YouTube
 * @param {string} params.youtubeUrl - URL do vídeo YouTube
 * @param {string} params.status - Status do processamento
 * @param {string} [params.note] - Notas adicionais
 */
export function appendMappingRow({
  env,
  jobId,
  wpPostId,
  vimeoId,
  vimeoUrl,
  vimeoTitle,
  youtubeId,
  youtubeUrl,
  status,
  note,
}) {
  const outDir = path.resolve("./data");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const file = path.join(outDir, `mapping.${env}.csv`);

  const header =
    "ts_utc,env,job_id,wp_post_id,vimeo_id,vimeo_url,vimeo_title,youtube_id,youtube_url,status,note\n";

  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, header, "utf8");
    logger.info(`Created mapping file`, { file });
  }

  const row = [
    new Date().toISOString(),
    env,
    jobId,
    wpPostId,
    vimeoId,
    vimeoUrl,
    vimeoTitle,
    youtubeId,
    youtubeUrl,
    status,
    note || "",
  ]
    .map(csvEscape)
    .join(",") + "\n";

  fs.appendFileSync(file, row, "utf8");
  logger.debug(`Row appended to mapping`, { env, jobId, status });
}

/**
 * Lê e retorna todas as linhas do CSV de mapeamento
 * @param {string} env - Ambiente (qa, prod, dev)
 * @returns {Array<Object>|null} Array de objetos ou null se arquivo não existe
 */
export function readMapping(env) {
  const outDir = path.resolve("./data");
  const file = path.join(outDir, `mapping.${env}.csv`);

  if (!fs.existsSync(file)) {
    return null;
  }

  const content = fs.readFileSync(file, "utf8");
  const lines = content.trim().split("\n");
  const headers = lines[0].split(",");

  return lines.slice(1).map((line) => {
    const values = line.split(",");
    return headers.reduce((obj, header, i) => {
      obj[header] = values[i];
      return obj;
    }, {});
  });
}

/**
 * Gera relatório resumido do mapeamento
 * @param {string} env - Ambiente (qa, prod, dev)
 * @returns {Object} Estatísticas do mapeamento
 * @property {number} total - Total de registros
 * @property {number} done - Concluídos com sucesso
 * @property {number} failed - Falhas
 * @property {number} done_resume - Retomados e concluídos
 */
export function getMappingStats(env) {
  const data = readMapping(env);
  if (!data) return { total: 0, done: 0, failed: 0, done_resume: 0 };

  const stats = {
    total: data.length,
    done: data.filter((r) => r.status === "done").length,
    failed: data.filter((r) => r.status === "failed").length,
    done_resume: data.filter((r) => r.status === "done_resume").length,
  };

  return stats;
}
