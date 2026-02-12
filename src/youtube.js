import fs from "node:fs";
import { google } from "googleapis";
import { config } from "./config.js";
import { makeSpeedMeter } from "./metrics.js";
import { logger } from "./utils/logger.js";
import { UploadConfig, YouTubeQuota, ErrorMessages } from "./constants.js";

/**
 * Trunca texto para limite máximo do YouTube
 * @param {string} text - Texto original
 * @param {number} maxLength - Limite máximo
 * @returns {string} Texto truncado
 */
function truncateText(text, maxLength) {
  if (!text || text.length <= maxLength) return text || "";
  return text.substring(0, maxLength - 3) + "...";
}

/**
 * Prepara tags para o YouTube (máx 500 chars total, 30 tags)
 * @param {string[]} tags - Array de tags
 * @returns {string[]} Tags formatadas para YouTube
 */
function prepareYouTubeTags(tags) {
  if (!tags || !Array.isArray(tags) || tags.length === 0) {
    return [];
  }

  // YouTube limit: 500 characters total for all tags, max 30 tags
  const maxTags = 30;
  const maxTotalLength = 500;
  
  const processedTags = [];
  let totalLength = 0;

  for (const tag of tags.slice(0, maxTags)) {
    // Remove caracteres inválidos para tags do YouTube
    // Apenas letras, números, espaços e caracteres especiais básicos
    let cleanTag = String(tag)
      .replace(/[<>]/g, '') // Remove < e >
      .trim();
    
    if (cleanTag.length === 0) continue;
    
    // YouTube tags são separadas por vírgula, então não pode ter vírgula na tag
    cleanTag = cleanTag.replace(/,/g, ' ');
    
    // Verifica se cabe no limite total
    if (totalLength + cleanTag.length + 2 > maxTotalLength) { // +2 para ", "
      break;
    }
    
    processedTags.push(cleanTag);
    totalLength += cleanTag.length + 2;
  }

  return processedTags;
}

/**
 * Constrói a descrição do vídeo para YouTube
 * @param {Object} params
 * @param {string} params.originalDescription - Descrição original do WordPress/Vimeo
 * @param {string} params.vimeoUrl - URL do Vimeo
 * @param {string} params.vimeoId - ID do vídeo Vimeo
 * @param {number} params.wpPostId - ID do post WordPress
 * @param {string} params.postUrl - URL da matéria no Brazil Journal
 * @returns {string} Descrição formatada
 */
function buildDescription({ originalDescription, vimeoUrl, vimeoId, wpPostId, postUrl }) {
  const orig = (originalDescription || "").trim();
  
  // Footer com link da matéria (sempre adicionado no final)
  const footer = postUrl 
    ? `\n\nAssista no Brazil Journal: ${postUrl}`
    : "";

  // Concatena descrição original + footer
  return (orig ? orig : "") + footer;
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
 * @param {string[]} [params.tags] - Tags do vídeo (opcional)
 * @param {string} params.vimeoUrl - URL original do Vimeo
 * @param {string} params.vimeoId - ID do vídeo Vimeo
 * @param {number} params.wpPostId - ID do post WordPress
 * @param {string} params.postUrl - URL da matéria no Brazil Journal
 * @returns {Promise<Object>} Resultado do upload
 * @property {string} youtubeId - ID do vídeo no YouTube
 * @property {string} youtubeUrl - URL curta do YouTube
 * @throws {Error} Se falhar o upload ou não retornar ID
 */
export async function uploadToYouTube({ filePath, title, description, tags, vimeoUrl, vimeoId, wpPostId, postUrl }) {
  logger.info(`Starting YouTube upload`, { filePath, vimeoId, hasTags: !!(tags && tags.length) });

  const yt = youtubeClient();
  const fileSize = fs.statSync(filePath).size;

  const meter = makeSpeedMeter();
  let lastLog = Date.now();

  // Trunca título para limite do YouTube (100 caracteres)
  const finalTitle = truncateText((title || "").trim(), YouTubeQuota.MAX_TITLE_LENGTH) || `Video ${vimeoId || ""}`.trim() || "Video";
  
  // Constrói descrição com footer do Brazil Journal
  const fullDescription = buildDescription({
    originalDescription: description,
    vimeoUrl,
    vimeoId,
    wpPostId,
    postUrl
  });
  
  // Trunca descrição para limite do YouTube (5000 caracteres)
  const finalDescription = truncateText(fullDescription, YouTubeQuota.MAX_DESCRIPTION_LENGTH);

  // Prepara tags para YouTube
  const youTubeTags = prepareYouTubeTags(tags);

  logger.debug(`YouTube upload params`, {
    titleLength: finalTitle.length,
    descriptionLength: finalDescription.length,
    tagsCount: youTubeTags.length,
    tagsTotalLength: youTubeTags.join(", ").length
  });

  const res = await yt.videos.insert(
    {
      part: ["snippet", "status"],
      requestBody: {
        snippet: {
          title: finalTitle,
          description: finalDescription,
          categoryId: UploadConfig.DEFAULT_CATEGORY_ID,
          tags: youTubeTags, // Tags do WordPress
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
    fileSize,
    title: finalTitle.substring(0, 50),
    tagsUsed: youTubeTags.length
  });

  return { youtubeId, youtubeUrl };
}
