import fs from "node:fs";
import { config } from "./config.js";
import { fetchEmbedCandidates, updatePostContent } from "./embed-wordpress.js";
import { extractVimeoIds } from "./embed-scanner.js";
import { rewriteContent } from "./embed-rewriter.js";
import { downloadVimeoToFile } from "./vimeo.js";
import { uploadToYouTube } from "./youtube.js";
import { logger } from "./utils/logger.js";
import { EmbedJobStatus } from "./constants.js";
import { classifyEmbedError } from "./embed-errors.js";

/**
 * Resolve um vídeo do Vimeo para um ID do YouTube.
 * Tenta dedup; se faltar e não for dry-run, baixa e sobe.
 * @param {Object} embedDb
 * @param {string} vimeoId
 * @param {Object} post - Linha de embed_posts
 * @param {boolean} dryRun
 * @returns {Promise<{youtubeId:string, youtubeUrl:string, reused:boolean}|null>}
 */
async function resolveVideo(embedDb, vimeoId, post, dryRun) {
  const existing = embedDb.resolveYoutubeId(vimeoId);
  if (existing) {
    logger.info("Video reused (dedup)", {
      vimeoId,
      source: existing.source,
      youtubeUrl: existing.youtubeUrl,
    });
    return { youtubeId: existing.youtubeId, youtubeUrl: existing.youtubeUrl, reused: true };
  }

  if (dryRun) {
    logger.info("[dry-run] would download + upload", { vimeoId });
    return null;
  }

  const dl = await downloadVimeoToFile({ vimeoId, outDir: config.tmpDir });
  try {
    const yt = await uploadToYouTube({
      filePath: dl.outPath,
      title: dl.title || `Video ${vimeoId}`,
      description: "",
      tags: [],
      vimeoUrl: dl.vimeoUrl,
      vimeoId,
      wpPostId: post.wp_post_id,
      postUrl: post.post_url,
      createdTime: dl.createdTime,
    });

    embedDb.recordVideoMap({
      vimeo_id: vimeoId,
      youtube_id: yt.youtubeId,
      youtube_url: yt.youtubeUrl,
      vimeo_name: dl.title || null,
      source_post_id: post.wp_post_id,
    });

    logger.info("Video uploaded", { vimeoId, youtubeUrl: yt.youtubeUrl });
    return { youtubeId: yt.youtubeId, youtubeUrl: yt.youtubeUrl, reused: false };
  } finally {
    // Remove o arquivo temporário mesmo se o upload falhar (evita encher o disco)
    if (config.worker.cleanupOk) {
      try {
        fs.unlinkSync(dl.outPath);
      } catch (e) {
        logger.warn("Cleanup failed", { filePath: dl.outPath, error: e.message });
      }
    }
  }
}

/**
 * Migra uma matéria: rebusca conteúdo fresco, resolve os vídeos,
 * reescreve e grava. Em dry-run não baixa, não sobe e não grava.
 * @param {Object} embedDb
 * @param {Object} post - Linha de embed_posts
 * @param {Object} [opts]
 * @param {boolean} [opts.dryRun=false]
 */
export async function migrateEmbedPost(embedDb, post, { dryRun = false } = {}) {
  const data = await fetchEmbedCandidates({ postId: post.wp_post_id });
  const item = data.items && data.items[0];

  if (!item) {
    if (!dryRun) {
      embedDb.setEmbedPostStatus(post.id, EmbedJobStatus.NO_VIDEOS, {
        error: "post not returned by WP",
      });
    }
    logger.warn("Post not returned by WP", { wpPostId: post.wp_post_id });
    return;
  }

  const vimeoIds = extractVimeoIds(item.content);
  if (vimeoIds.length === 0) {
    if (!dryRun) {
      embedDb.setEmbedPostStatus(post.id, EmbedJobStatus.NO_VIDEOS, { error: null });
    }
    logger.info("No Vimeo embeds in fresh content", { wpPostId: post.wp_post_id });
    return;
  }

  const videoMap = {};
  let allResolved = true;
  for (const vid of vimeoIds) {
    const r = await resolveVideo(embedDb, vid, post, dryRun);
    if (r) videoMap[vid] = r.youtubeId;
    else allResolved = false;
  }

  if (dryRun) {
    logger.info("[dry-run] post processed", {
      wpPostId: post.wp_post_id,
      videos: vimeoIds.length,
      resolvedNow: Object.keys(videoMap).length,
    });
    return;
  }

  if (!allResolved) {
    throw new Error("Not all videos resolved");
  }

  const { content: newContent, missingIds } = rewriteContent(item.content, videoMap);
  if (missingIds.length > 0) {
    throw new Error(`Rewrite left unresolved videos: ${missingIds.join(",")}`);
  }
  if (extractVimeoIds(newContent).length > 0) {
    throw new Error("Rewrite validation failed: Vimeo embeds still present");
  }

  await updatePostContent({ postId: post.wp_post_id, content: newContent });

  embedDb.setEmbedPostStatus(post.id, EmbedJobStatus.DONE, { error: null });
  logger.info("Post migrated", { wpPostId: post.wp_post_id, videos: vimeoIds.length });
}

/**
 * Loop da fase `migrate`.
 * @param {Object} embedDb
 * @param {Object} [opts]
 * @param {boolean} [opts.dryRun=false]
 * @param {number} [opts.limit=0] - 0 = sem limite
 * @returns {Promise<{processed:number}>}
 */
export async function runEmbedWorkerLoop(embedDb, { dryRun = false, limit = 0 } = {}) {
  let processed = 0;

  if (dryRun) {
    const posts = embedDb.pendingEmbedPosts();
    for (const post of posts) {
      if (limit > 0 && processed >= limit) break;
      logger.info("[dry-run] Starting embed post", {
        id: post.id,
        wpPostId: post.wp_post_id,
      });
      try {
        await migrateEmbedPost(embedDb, post, { dryRun: true });
      } catch (err) {
        logger.error("[dry-run] would fail", {
          id: post.id,
          error: err?.message || String(err),
        });
      }
      processed++;
    }
    logger.info("[dry-run] finished", { processed });
    return { processed };
  }

  while (true) {
    if (limit > 0 && processed >= limit) {
      logger.info("Reached limit", { limit });
      break;
    }
    const post = embedDb.nextEmbedPost();
    if (!post) {
      logger.info("No more embed posts to process");
      break;
    }

    embedDb.incEmbedPostAttempts(post.id);
    embedDb.setEmbedPostStatus(post.id, EmbedJobStatus.PROCESSING);
    logger.info("Starting embed post", {
      id: post.id,
      wpPostId: post.wp_post_id,
      attempt: post.attempts + 1,
    });

    try {
      await migrateEmbedPost(embedDb, post, { dryRun: false });
    } catch (err) {
      const msg = err?.response?.data
        ? JSON.stringify(err.response.data)
        : err?.message || String(err);
      const status = classifyEmbedError(err);
      embedDb.setEmbedPostStatus(post.id, status, { error: msg });
      if (status === EmbedJobStatus.SKIPPED_EXTERNAL) {
        logger.warn("Embed post pulada — video do Vimeo e de terceiros (nao baixavel)", {
          id: post.id,
          wpPostId: post.wp_post_id,
          postUrl: post.post_url,
        });
      } else {
        logger.error("Embed post failed", { id: post.id, error: msg });
      }
    }
    processed++;
  }

  const stats = embedDb.embedStats();
  logger.info("Embed worker loop finished", { processed, stats });
  return { processed, stats };
}
