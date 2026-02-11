import fs from "node:fs";
import { config } from "./config.js";
import { nextJob, setStatus, incAttempts, getDailyQuotaStatus, canUploadToday, incrementUploadCount } from "./db.js";
import { downloadVimeoToFile } from "./vimeo.js";
import { uploadToYouTube } from "./youtube.js";
import { updateWpYouTubeUrl } from "./wordpress.js";
import { appendMappingRow } from "./report.js";

function log(line) {
  const msg = `[${new Date().toISOString()}] ${line}`;
  console.log(msg);
  fs.appendFileSync(config.logFile, msg + "\n");
}

function envName() {
  // você está usando NODE_ENV=qa/prod nos scripts, então vamos usar isso como “env”
  return process.env.NODE_ENV || "dev";
}

export async function runWorkerOnce() {
  // Check quota before processing
  if (!canUploadToday(config.quota.maxUploadsPerDay)) {
    const quotaStatus = getDailyQuotaStatus();
    log(`QUOTA EXHAUSTED: ${quotaStatus.upload_count}/${config.quota.maxUploadsPerDay} uploads today (${quotaStatus.quota_used}/${config.quota.dailyLimit} units)`);
    log("Stopping worker to preserve YouTube API quota. Resume tomorrow.");
    return false; // Stop the loop
  }

  const job = nextJob();
  if (!job) {
    log("No jobs queued/failed.");
    return false;
  }

  // Show quota status at start of each job
  const quotaStatus = getDailyQuotaStatus();
  log(`QUOTA STATUS: ${quotaStatus.upload_count}/${config.quota.maxUploadsPerDay} uploads today (${quotaStatus.quota_used}/${config.quota.dailyLimit} units)`);

  incAttempts(job.id);

  const env = envName();

  log(`JOB ${job.id} post=${job.wp_post_id} vimeo=${job.vimeo_id} attempt=${job.attempts + 1}`);
  
  try {
    // 🔁 Se já temos youtube_url salvo no job (upload já foi feito em tentativa anterior),
    // pula download/upload e tenta só atualizar o WP.
    if (job.youtube_url) {
      log(`RESUME job=${job.id}: already uploaded => ${job.youtube_url}. Trying WP update only...`);

      setStatus(job.id, "updating_wp", {
        youtube_id: job.youtube_id || null,
        youtube_url: job.youtube_url
      });

      await updateWpYouTubeUrl({
        postId: job.wp_post_id,
        metaKey: config.wp.metaKey,
        youtubeUrl: job.youtube_url
      });

      setStatus(job.id, "done", { error: null });

      appendMappingRow({
          env,
          jobId: job.id,
          wpPostId: job.wp_post_id,
          vimeoId: job.vimeo_id,
          vimeoUrl: job.vimeo_url || `https://vimeo.com/${job.vimeo_id}`,
          vimeoTitle: "",
          youtubeId: job.youtube_id || "",
          youtubeUrl: job.youtube_url,
          status: "done_resume",
          note: "WP update retried without reupload",
      });

      log(`DONE (resume) job=${job.id} => ${job.youtube_url}`);
      return true;
    }
    // 1) DOWNLOAD (agora também devolve title/description/vimeoUrl)
    setStatus(job.id, "downloading");
    const dl = await downloadVimeoToFile({ vimeoId: job.vimeo_id, outDir: config.tmpDir });

    setStatus(job.id, "uploading", {
      local_path: dl.outPath,
      file_size_bytes: dl.fileSize,
    });

    // 2) UPLOAD YT com meta do Vimeo
    // Obs: o youtube.js vai montar o footer "Migrated from Vimeo..." + IDs
    const yt = await uploadToYouTube({
      filePath: dl.outPath,
      title: dl.title,               // ✅ título original do Vimeo
      description: dl.description,   // ✅ descrição original do Vimeo
      vimeoUrl: dl.vimeoUrl || job.vimeo_url,
      vimeoId: job.vimeo_id,
      wpPostId: job.wp_post_id,
    });

    setStatus(job.id, "updating_wp", {
      youtube_id: yt.youtubeId,
      youtube_url: yt.youtubeUrl,
    });

    // 3) UPDATE WP
    await updateWpYouTubeUrl({
      postId: job.wp_post_id,
      metaKey: config.wp.metaKey,
      youtubeUrl: yt.youtubeUrl,
    });

    // 4) DONE + CLEANUP
    setStatus(job.id, "done", { error: null });

    // Increment quota counter after successful upload
    incrementUploadCount(config.quota.uploadCost);

    // CSV de controle (DONE)
    appendMappingRow({
      env,
      jobId: job.id,
      wpPostId: job.wp_post_id,
      vimeoId: job.vimeo_id,
      vimeoUrl: dl.vimeoUrl || job.vimeo_url,
      vimeoTitle: dl.title || "",
      youtubeId: yt.youtubeId,
      youtubeUrl: yt.youtubeUrl,
      status: "done",
      note: "",
    });

    if (config.worker.cleanupOk) {
      try {
        fs.unlinkSync(dl.outPath);
        log(`CLEANUP ok: removed ${dl.outPath}`);
      } catch (e) {
        log(`CLEANUP failed: ${e.message}`);
      }
    }

    log(`DONE job=${job.id} => ${yt.youtubeUrl}`);
    return true;
  } catch (e) {
    const err =
      e?.response?.data ? JSON.stringify(e.response.data) : e?.message || String(e);

    setStatus(job.id, "failed", { error: err });

    // CSV de controle (FAILED)
    appendMappingRow({
      env,
      jobId: job.id,
      wpPostId: job.wp_post_id,
      vimeoId: job.vimeo_id,
      vimeoUrl: job.vimeo_url || `https://vimeo.com/${job.vimeo_id}`,
      vimeoTitle: "",
      youtubeId: "",
      youtubeUrl: "",
      status: "failed",
      note: err,
    });

    log(`FAILED job=${job.id}: ${err}`);
    return true; // continua loopando
  }
}

export async function runWorkerLoop() {
  while (true) {
    const worked = await runWorkerOnce();
    if (!worked) break;
  }
}
