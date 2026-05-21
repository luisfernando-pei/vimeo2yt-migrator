import axios from "axios";
import { config } from "./config.js";
import { logger } from "./utils/logger.js";

/**
 * Monta os headers de autenticação para os endpoints de migração.
 * @returns {Object}
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
 * Busca matérias com vídeo do Vimeo embedado no conteúdo.
 * Se `postId` for informado, busca só aquela matéria (conteúdo fresco).
 * @param {Object} params
 * @param {number} [params.page=1]
 * @param {number} [params.perPage]
 * @param {number} [params.postId]
 * @returns {Promise<{page:number, per_page:number, total:number, total_pages:number, items:Array}>}
 */
export async function fetchEmbedCandidates({ page = 1, perPage, postId } = {}) {
  const params = new URLSearchParams();
  if (postId) {
    params.set("post_id", String(postId));
  } else {
    params.set("page", String(page));
    params.set("per_page", String(perPage ?? config.wp.batchSize));
  }
  const url = `${config.wp.baseUrl}/wp-json/migrate/v1/embed-candidates?${params.toString()}`;

  logger.debug("Fetching embed candidates", { page, postId });
  const res = await axios.get(url, { headers: wpHeaders() });

  const data = res.data;
  if (!data || !Array.isArray(data.items)) {
    throw new Error("Unexpected response from embed-candidates endpoint");
  }
  return data;
}

/**
 * Grava o post_content novo de uma matéria.
 * @param {Object} params
 * @param {number} params.postId
 * @param {string} params.content
 * @returns {Promise<Object>}
 */
export async function updatePostContent({ postId, content }) {
  const url = `${config.wp.baseUrl}/wp-json/migrate/v1/update-content`;

  const res = await axios.post(
    url,
    { post_id: postId, content },
    { headers: { ...wpHeaders(), "Content-Type": "application/json" } }
  );

  if (!res.data || res.data.ok !== true) {
    throw new Error(`update-content failed: ${JSON.stringify(res.data)}`);
  }
  logger.info("WordPress content updated", { postId });
  return res.data;
}
