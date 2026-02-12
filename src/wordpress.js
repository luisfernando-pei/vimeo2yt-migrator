import axios from "axios";
import { config } from "./config.js";
import { logger } from "./utils/logger.js";
import { ErrorMessages, HttpHeaders } from "./constants.js";

/**
 * Gera header de autenticação Basic para WordPress
 * @returns {Object} Header Authorization
 */
function wpAuthHeader() {
  const token = Buffer.from(`${config.wp.appUser}:${config.wp.appPass}`).toString("base64");
  return { Authorization: `Basic ${token}` };
}

/**
 * Gera headers para requisições WordPress
 * Inclui token de migração e auth basic se configurado
 * @returns {Object} Headers HTTP
 */
function wpHeaders() {
  const h = { "X-Migrate-Token": config.wp.migrateToken };

  if (config.wp.qaBasicUser && config.wp.qaBasicPass) {
    const t = Buffer.from(`${config.wp.qaBasicUser}:${config.wp.qaBasicPass}`).toString("base64");
    h["Authorization"] = `Basic ${t}`;
  }
  return h;
}

/**
 * Atualiza URL do YouTube no WordPress via endpoint custom
 * @param {Object} params
 * @param {number} params.postId - ID do post WordPress
 * @param {string} params.youtubeUrl - URL do YouTube para salvar
 * @returns {Promise<Object>} Resposta do WordPress
 * @throws {Error} Se a requisição falhar
 */
export async function updateWpYouTubeUrl({ postId, youtubeUrl }) {
  logger.debug(`Updating WordPress post ${postId} with YouTube URL`);

  const url = `${config.wp.baseUrl}/wp-json/migrate/v1/update-youtube`;

  const res = await axios.post(
    url,
    { post_id: postId, youtube_url: youtubeUrl },
    {
      headers: {
        ...wpHeaders(),
        "Content-Type": HttpHeaders.CONTENT_TYPE_JSON,
      },
    }
  );

  logger.info(`WordPress updated`, { postId, youtubeUrl });
  return res.data;
}

/**
 * Busca candidatos para migração no WordPress
 * Endpoint: GET /wp-json/migrate/v1/vimeo-candidates
 * @param {Object} params
 * @param {number} [params.perPage] - Itens por página (default: config.wp.batchSize)
 * @param {number} [params.page] - Página atual (default: 1)
 * @param {boolean} [params.force] - Forçar reprocessamento (default: false)
 * @returns {Promise<Object>} Resultado da busca
 * @property {number} page - Página atual
 * @property {number} per_page - Itens por página
 * @property {number} total - Total de itens
 * @property {number} total_pages - Total de páginas
 * @property {Array} items - Lista de candidatos [{id, vimeo_url}]
 * @throws {Error} Se a resposta for inválida
 */
export async function fetchWpCandidates({ perPage, page, force = false } = {}) {
  const pp = perPage ?? config.wp.batchSize;
  const p = page ?? 1;

  const url = `${config.wp.baseUrl}/wp-json/migrate/v1/vimeo-candidates?per_page=${pp}&page=${p}&force=${force ? "true" : "false"}`;

  logger.debug(`Fetching WordPress candidates`, { page: p, perPage: pp, force });

  const res = await axios.get(url, { headers: wpHeaders() });

  const data = res.data;
  if (!data || !Array.isArray(data.items)) {
    throw new Error(ErrorMessages.WP_UNEXPECTED_RESPONSE);
  }

  logger.debug(`Found candidates`, { 
    count: data.items.length, 
    total: data.total,
    totalPages: data.total_pages 
  });

  return data;
}
