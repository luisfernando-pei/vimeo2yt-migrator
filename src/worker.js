import fs from "node:fs";
import { config } from "./config.js";
import { nextJob, setStatus, incAttempts } from "./db.js";
import { downloadVimeoToFile } from "./vimeo.js";
import { uploadToYouTube } from "./youtube.js";
import { updateWpYouTubeUrl } from "./wordpress.js";
import { appendMappingRow } from "./report.js";
import { logger } from "./utils/logger.js";
import { JobStatus } from "./constants.js";

/**
 * Obtém o nome do ambiente atual
 * @returns {string} Nome do ambiente (qa, prod, dev)
 */
function getEnvName() {
  return process.env.NODE_ENV || "dev";
}

/**
 * Verifica se o job já foi uploadado anteriormente (resume)
 * @param {Object} job - Job do banco de dados
 * @returns {boolean}
 */
function isAlreadyUploaded(job) {
  return Boolean(job.youtube_url);
}

/**
 * Processa um job que já foi uploadado (tenta apenas atualizar WP)
 * @param {Object} job - Job do banco de dados
 * @returns {Promise<boolean>}
 */
async function processResumeJob(job) {
  const env = getEnvName();
  
  logger.info(`Resuming job`, { 
    jobId: job.id, 
    youtubeUrl: job.youtube_url 
  });

  setStatus(job.id, JobStatus.UPDATING_WP, {
    youtube_id: job.youtube_id || null,
    youtube_url: job.youtube_url
  });

  await updateWpYouTubeUrl({
    postId: job.wp_post_id,
    metaKey: config.wp.metaKey,
    youtubeUrl: job.youtube_url
  });

  setStatus(job.id, JobStatus.DONE, { error: null });

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

  logger.info(`Job completed (resume)`, { 
    jobId: job.id, 
    youtubeUrl: job.youtube_url 
  });
  
  return true;
}

/**
 * Executa o fluxo completo de download, upload e atualização
 * @param {Object} job - Job do banco de dados
 * @returns {Promise<boolean>}
 */
async function processFullJob(job) {
  const env = getEnvName();

  // 1) DOWNLOAD
  setStatus(job.id, JobStatus.DOWNLOADING);
  const dl = await downloadVimeoToFile({ 
    vimeoId: job.vimeo_id, 
    outDir: config.tmpDir 
  });

  // 2) UPLOAD YT
  setStatus(job.id, JobStatus.UPLOADING, {
    local_path: dl.outPath,
    file_size_bytes: dl.fileSize,
  });

  const yt = await uploadToYouTube({
    filePath: dl.outPath,
    title: dl.title,
    description: dl.description,
    vimeoUrl: dl.vimeoUrl || job.vimeo_url,
    vimeoId: job.vimeo_id,
    wpPostId: job.wp_post_id,
  });

  // 3) UPDATE WP
  setStatus(job.id, JobStatus.UPDATING_WP, {
    youtube_id: yt.youtubeId,
    youtube_url: yt.youtubeUrl,
  });

  await updateWpYouTubeUrl({
    postId: job.wp_post_id,
    metaKey: config.wp.metaKey,
    youtubeUrl: yt.youtubeUrl,
  });

  // 4) DONE + CLEANUP
  setStatus(job.id, JobStatus.DONE, { error: null });

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

  // Cleanup opcional
  if (config.worker.cleanupOk) {
    await cleanupFile(dl.outPath);
  }

  logger.info(`Job completed`, { 
    jobId: job.id, 
    youtubeUrl: yt.youtubeUrl 
  });
  
  return true;
}

/**
 * Remove arquivo local após processamento
 * @param {string} filePath - Caminho do arquivo
 */
async function cleanupFile(filePath) {
  try {
    fs.unlinkSync(filePath);
    logger.info(`Cleanup successful`, { filePath });
  } catch (e) {
    logger.warn(`Cleanup failed`, { filePath, error: e.message });
  }
}

/**
 * Trata erro de job e registra no CSV
 * @param {Object} job - Job do banco de dados
 * @param {Error} error - Erro ocorrido
 */
async function handleJobError(job, error) {
  const env = getEnvName();
  const err = error?.response?.data 
    ? JSON.stringify(error.response.data) 
    : error?.message || String(error);

  setStatus(job.id, JobStatus.FAILED, { error: err });

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

  logger.error(`Job failed`, { 
    jobId: job.id, 
    error: err 
  });
}


/**
 * Executa um único job do worker
 * @returns {Promise<boolean>} true se processou um job, false se não há jobs
 */
export async function runWorkerOnce() {
  const job = nextJob();
  
  if (!job) {
    logger.info("No jobs queued or failed");
    return false;
  }

  incAttempts(job.id);

  logger.info(`Starting job`, {
    jobId: job.id,
    postId: job.wp_post_id,
    vimeoId: job.vimeo_id,
    attempt: job.attempts + 1
  });

  try {
    if (isAlreadyUploaded(job)) {
      await processResumeJob(job);
    } else {
      await processFullJob(job);
    }
    return true;
  } catch (error) {
    await handleJobError(job, error);
    return true; // Continua loopando mesmo com erro
  }
}


/**
 * Executa o worker em loop contínuo
 * Processa jobs até não haver mais na fila
 */
export async function runWorkerLoop() {
  logger.info("Starting worker loop");
  
  let processedCount = 0;
  
  while (true) {
    const worked = await runWorkerOnce();
    if (!worked) break;
    processedCount++;
  }
  
  logger.info("Worker loop finished", { processedCount });
}
