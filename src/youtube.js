import fs from "node:fs";
import { google } from "googleapis";
import { config } from "./config.js";
import { makeSpeedMeter } from "./metrics.js";
import { logger } from "./utils/logger.js";
import { UploadConfig, ErrorMessages } from "./constants.js";

/**
 * Constrói a descrição do vídeo para YouTube
 * @param {Object} params
 * @param {string} params.originalDescription - Descrição original do Vimeo
 * @param {string} params.vimeoUrl - URL do Vimeo
 * @param {string} params.vimeoId - ID do vídeo Vimeo
 * @param {number} params.wpPostId - ID do post WordPress
 * @returns {string} Descrição formatada
 */
function buildDescription({ originalDescription, vimeoUrl, vimeoId, wpPostId }) {
  const orig = (originalDescription || "").trim();
  const footer = "";
  // const footer =
  //   `\n\n---\n` +
  //   `Migrated from Vimeo: ${vimeoUrl || `https://vimeo.com/${vimeoId}`}\n` +
  //   `Vimeo ID: ${vimeoId || ""}\n` +
  //   `WP Post ID: ${wpPostId || ""}\n`;

  // se não tinha descrição, não deixa começar com linha vazia
  return (orig ? orig + footer : footer.trim());
}

/**
 * Cria cliente OAuth2 do YouTube
 * @returns {Object} Cliente YouTube API configurado
 */
function youtubeClient() {
  const oauth2 = new google.auth.OAuth2(
    config.yt.clientId,
    config.yt.clientSecret,
    config.yt.redirectUri
  );

  oauth2.setCredentials({ refresh_token: config.yt.refreshToken });

  return google.youtube({ version: "v3", auth: oauth2 });
}

/**
 * Faz upload de vídeo para o YouTube
 * @param {Object} params
 * @param {string} params.filePath - Caminho do arquivo local
 * @param {string} params.title - Título do vídeo
 * @param {string} params.description - Descrição do vídeo
 * @param {string} params.vimeoUrl - URL original do Vimeo
 * @param {string} params.vimeoId - ID do vídeo Vimeo
 * @param {number} params.wpPostId - ID do post WordPress
 * @returns {Promise<Object>} Resultado do upload
 * @property {string} youtubeId - ID do vídeo no YouTube
 * @property {string} youtubeUrl - URL curta do YouTube
 * @throws {Error} Se falhar o upload ou não retornar ID
 */
export async function uploadToYouTube({ filePath, title, description, vimeoUrl, vimeoId, wpPostId }) {
  logger.info(`Starting YouTube upload`, { filePath, vimeoId });

  const yt = youtubeClient();
  const fileSize = fs.statSync(filePath).size;

  const meter = makeSpeedMeter();
  let lastLog = Date.now();

  const finalTitle = (title || "").trim() || `Video ${vimeoId || ""}`.trim() || "Video";
  const finalDescription = buildDescription({
    originalDescription: description,
    vimeoUrl,
    vimeoId,
    wpPostId
  });

  const res = await yt.videos.insert(
    {
      part: ["snippet", "status"],
      requestBody: {
        snippet: {
          title: finalTitle,
          description: finalDescription,
          categoryId: UploadConfig.DEFAULT_CATEGORY_ID
        },
        status: {
          privacyStatus: config.yt.privacyStatus || UploadConfig.DEFAULT_PRIVACY_STATUS,
          selfDeclaredMadeForKids: UploadConfig.DEFAULT_MADE_FOR_KIDS,
        }
      },
      media: {
        body: fs.createReadStream(filePath).on("data", (chunk) => {
          meter.tick(chunk.length);
          if (Date.now() - lastLog > UploadConfig.PROGRESS_LOG_INTERVAL_MS) {
            lastLog = Date.now();
            const s = meter.snapshot();
            const pct = (s.bytes / fileSize) * 100;
            logger.progress("UP", vimeoId, {
              bytes: s.bytes,
              total: fileSize,
              mbps: s.mbps,
              eta: `${pct.toFixed(1)}%`,
            });
          }
        })
      }
    },
    {
      // importante para upload grande
      onUploadProgress: () => {}
    }
  );

  logger.progressEnd();

  const youtubeId = res.data.id;
  if (!youtubeId) {
    throw new Error(ErrorMessages.YOUTUBE_NO_VIDEO_ID);
  }

  const youtubeUrl = `https://youtu.be/${youtubeId}`;
  
  logger.info(`YouTube upload completed`, { 
    vimeoId, 
    youtubeId, 
    youtubeUrl,
    fileSize 
  });

  return { youtubeId, youtubeUrl };
}
