import axios from "axios";
import { config } from "./config.js";

function wpAuthHeader() {
  const token = Buffer.from(`${config.wp.appUser}:${config.wp.appPass}`).toString("base64");
  return { Authorization: `Basic ${token}` };
}

function wpHeaders() {
  const h = { "X-Migrate-Token": config.wp.migrateToken };

  if (config.wp.qaBasicUser && config.wp.qaBasicPass) {
    const t = Buffer.from(`${config.wp.qaBasicUser}:${config.wp.qaBasicPass}`).toString("base64");
    h["Authorization"] = `Basic ${t}`;
  }
  return h;
}

/**
 * Atualiza ACF via meta REST:
 * - Se você tiver um endpoint custom de update, melhor.
 * - Aqui usamos /wp/v2/{postType}/{id} com "meta".
 *
 * ATENÇÃO:
 * Para isso funcionar, o meta url_do_youtube precisa estar show_in_rest=true.
 * Se não estiver, faça um endpoint custom de update também.
 */
export async function updateWpYouTubeUrl({ postId, youtubeUrl }) {
  const url = `${config.wp.baseUrl}/wp-json/migrate/v1/update-youtube`;

  const res = await axios.post(
    url,
    { post_id: postId, youtube_url: youtubeUrl },
    {
      headers: {
        ...wpHeaders(),
        "Content-Type": "application/json",
      },
    }
  );

  return res.data;
}
/**
 * Usa APENAS o endpoint custom:
 * GET /wp-json/migrate/v1/vimeo-candidates?per_page=20&page=1&force=false
 *
 * Retorna: [{id, vimeo_url}]
 */
export async function fetchWpCandidates({ perPage, page, force = false } = {}) {
  const pp = perPage ?? config.wp.batchSize;
  const p = page ?? 1;

  const url = `${config.wp.baseUrl}/wp-json/migrate/v1/vimeo-candidates?per_page=${pp}&page=${p}&force=${force ? "true" : "false"}`;

  const res = await axios.get(url, { headers: wpHeaders() });

  const data = res.data;
  if (!data || !Array.isArray(data.items)) {
    throw new Error(`Unexpected response from vimeo-candidates endpoint`);
  }

  return data; // {page, per_page, total, total_pages, items}
}