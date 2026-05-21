import { EmbedJobStatus, ErrorMessages } from "./constants.js";

/**
 * Classifica um erro de migração no status apropriado de embed_posts.
 *
 * Vídeo do Vimeo sem links de download = vídeo de outra conta (terceiros),
 * que a API do Vimeo não permite baixar. Isso nunca vai funcionar numa
 * nova tentativa, então vira `skipped_external` (a fila não re-tenta).
 *
 * Qualquer outro erro (rede, quota, etc.) é potencialmente transitório,
 * então vira `failed` (a fila re-tenta até MAX_ATTEMPTS).
 *
 * @param {Error|*} err - Erro capturado durante a migração de uma matéria
 * @returns {string} EmbedJobStatus.SKIPPED_EXTERNAL ou EmbedJobStatus.FAILED
 */
export function classifyEmbedError(err) {
  if (err && err.message === ErrorMessages.VIMEO_NO_DOWNLOAD_LINKS) {
    return EmbedJobStatus.SKIPPED_EXTERNAL;
  }
  return EmbedJobStatus.FAILED;
}
