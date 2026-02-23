import axios from "axios";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { makeSpeedMeter, eta } from "./metrics.js";
import { logger } from "./utils/logger.js";
import { Patterns, DownloadConfig, ErrorMessages } from "./constants.js";

/**
 * Extrai o ID do Vimeo de uma URL
 * @param {string} url - URL do Vimeo (ex: https://vimeo.com/887028319)
 * @returns {string|null} ID do vídeo ou null se inválido
 * @example
 * parseVimeoId("https://vimeo.com/887028319") // "887028319"
 * parseVimeoId("https://vimeo.com/888452457/3705d4f6e5") // "888452457"
 */
export function parseVimeoId(url) {
  const m = String(url).match(Patterns.VIMEO_ID);
  return m ? m[1] : null;
}
/**
 * Obtém URL de download do Vimeo via API
 * @param {string} vimeoId - ID do vídeo Vimeo
 * @returns {Promise<Object>} Informações do vídeo e URL de download
 * @property {string} url - URL direta para download
 * @property {number|null} size - Tamanho em bytes
 * @property {string|null} quality - Qualidade do vídeo
 * @property {string} title - Título do vídeo
 * @property {string} description - Descrição do vídeo
 * @property {number|null} duration - Duração em segundos
 * @property {string} vimeoUrl - URL original do Vimeo
 * @throws {Error} Se não houver links de download disponíveis
 */
export async function getVimeoDownloadUrl(vimeoId) {
  logger.debug(`Fetching Vimeo API for video ${vimeoId}`);

  const res = await axios.get(`https://api.vimeo.com/videos/${vimeoId}`, {
    headers: { Authorization: `Bearer ${config.vimeoToken}` },
    timeout: DownloadConfig.CONNECTION_TIMEOUT_MS,
  });

  const v = res.data;
  const download = v.download;
  const title = v?.name || `Video ${vimeoId}`;
  const description = v?.description || "";
  const duration = v?.duration || null;
  const vimeoUrl = v?.link || `https://vimeo.com/${vimeoId}`;
  const createdTime = v?.created_time || null;

  if (Array.isArray(download) && download.length) {
    const sorted = [...download].sort((a, b) => (b.size || 0) - (a.size || 0));
    logger.debug(`Found download link for ${vimeoId}`, { 
      size: sorted[0].size, 
      quality: sorted[0].quality 
    });
    return {
      url: sorted[0].link,
      size: sorted[0].size || null,
      quality: sorted[0].quality || null,
      title,
      description,
      duration,
      vimeoUrl,
      createdTime,
    };
  }

  const progressive = res.data.files?.progressive;
  if (Array.isArray(progressive) && progressive.length) {
    const sorted = [...progressive].sort((a, b) => (b.width || 0) - (a.width || 0));
    logger.debug(`Found progressive stream for ${vimeoId}`, { 
      quality: sorted[0].quality 
    });
    return {
      url: sorted[0].url,
      size: null,
      quality: `${sorted[0].quality || ""}`.trim() || null,
      title,
      description,
      duration,
      vimeoUrl,
      createdTime,
    };
  }

  throw new Error(ErrorMessages.VIMEO_NO_DOWNLOAD_LINKS.replace("${vimeoId}", vimeoId));
}

/**
 * Baixa vídeo do Vimeo para arquivo local
 * @param {Object} params
 * @param {string} params.vimeoId - ID do vídeo Vimeo
 * @param {string} params.outDir - Diretório de saída
 * @returns {Promise<Object>} Resultado do download
 * @property {string} outPath - Caminho do arquivo baixado
 * @property {number} fileSize - Tamanho em bytes
 * @property {string|null} quality - Qualidade do vídeo
 * @property {string} title - Título do vídeo
 * @property {string} description - Descrição do vídeo
 * @property {number|null} duration - Duração em segundos
 * @property {string} vimeoUrl - URL original do Vimeo
 * @throws {Error} Se falhar o download
 */
export async function downloadVimeoToFile({ vimeoId, outDir }) {
  logger.info(`Starting download`, { vimeoId, outDir });

  const info = await getVimeoDownloadUrl(vimeoId);

  const filename = `vimeo_${vimeoId}.mp4`;
  const outPath = path.join(outDir, filename);

  const meter = makeSpeedMeter();

  const resp = await axios.get(info.url, { 
    responseType: "stream",
    timeout: DownloadConfig.DOWNLOAD_TIMEOUT_MS,
  });

  const total = Number(resp.headers["content-length"] || info.size || 0);
  let lastLog = Date.now();

  await new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(outPath);

    resp.data.on("data", (chunk) => {
      meter.tick(chunk.length);
      if (Date.now() - lastLog > DownloadConfig.PROGRESS_LOG_INTERVAL_MS) {
        lastLog = Date.now();
        const s = meter.snapshot();
        if (total > 0) {
          const leftBytes = total - s.bytes;
          const secLeft = s.bps > 0 ? leftBytes / s.bps : Infinity;
          logger.progress("DL", vimeoId, {
            bytes: s.bytes,
            total,
            mbps: s.mbps,
            eta: eta(secLeft),
          });
        } else {
          process.stdout.write(`\rDL ${vimeoId}: ${meter.format()}      `);
        }
      }
    });

    resp.data.pipe(ws);
    ws.on("finish", resolve);
    ws.on("error", reject);
    resp.data.on("error", reject);
  });

  logger.progressEnd();

  const fileSize = fs.statSync(outPath).size;
  
  logger.info(`Download completed`, { 
    vimeoId, 
    outPath, 
    fileSize,
    quality: info.quality 
  });
  
  return { 
    outPath, 
    fileSize, 
    quality: info.quality,
    title: info.title,
    description: info.description,
    duration: info.duration,
    vimeoUrl: info.vimeoUrl,
    createdTime: info.createdTime,
  };
}
