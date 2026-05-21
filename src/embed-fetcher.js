import fs from "node:fs";
import path from "node:path";
import { fetchEmbedCandidates } from "./embed-wordpress.js";
import { extractVimeoIds } from "./embed-scanner.js";
import { config } from "./config.js";
import { logger } from "./utils/logger.js";

/**
 * Escapa um valor para uma célula de CSV.
 * @param {*} v
 * @returns {string}
 */
function csvField(v) {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, "\"\"")}"` : s;
}

/**
 * Fase `scan`: percorre as matérias com vídeo embedado, monta a fila
 * em `embed_posts` e gera um CSV de pré-visualização do dedup.
 * Não altera nada em produção.
 * @param {Object} embedDb - Instância de createEmbedDb
 * @returns {Promise<Object>} Resumo da operação
 */
export async function scanAndQueue(embedDb) {
  let page = 1;
  let totalPosts = 0;
  let totalVideos = 0;
  let queuedPosts = 0;
  let reused = 0;
  let needUpload = 0;
  let skippedNoTitle = 0;

  const csvPath = path.join("data", `embed-scan.${config.appEnv}.csv`);
  const csvLines = ["wp_post_id,title,post_url,vimeo_id,dedup"];

  logger.info("Starting embed scan");

  while (true) {
    const data = await fetchEmbedCandidates({ page });

    for (const item of data.items) {
      const ids = extractVimeoIds(item.content);
      if (ids.length === 0) continue;

      // Matéria sem título = post quebrado no WordPress — não enfileira.
      if (!item.title || String(item.title).trim() === "") {
        skippedNoTitle++;
        logger.warn("Materia ignorada — sem titulo (post quebrado no WP)", {
          wpPostId: item.id,
          postUrl: item.post_url,
        });
        continue;
      }

      totalPosts++;
      totalVideos += ids.length;

      const inserted = embedDb.upsertEmbedPost({
        wp_post_id: item.id,
        title: item.title,
        post_url: item.post_url,
        post_date: item.post_date,
        video_count: ids.length,
      });
      if (inserted) queuedPosts++;

      for (const vid of ids) {
        const resolved = embedDb.resolveYoutubeId(vid);
        const dedup = resolved ? resolved.source : "needs_upload";
        if (resolved) reused++;
        else needUpload++;
        csvLines.push(
          [item.id, csvField(item.title), csvField(item.post_url), vid, dedup].join(",")
        );
      }
    }

    if (page >= (data.total_pages || 1)) break;
    page++;
  }

  fs.writeFileSync(csvPath, csvLines.join("\n") + "\n");

  const summary = { totalPosts, totalVideos, queuedPosts, reused, needUpload, skippedNoTitle, csvPath };
  logger.info("Embed scan completed", summary);
  return summary;
}
