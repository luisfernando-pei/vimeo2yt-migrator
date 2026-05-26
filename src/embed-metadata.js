/**
 * Normaliza tags vindas do WordPress para o formato esperado pelo YouTube.
 * @param {unknown} tags
 * @returns {string[]}
 */
function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  return tags.map((tag) => String(tag).trim()).filter(Boolean);
}

/**
 * Monta os metadados de upload para videos embedados no post_content.
 * Prioriza os dados da materia WordPress, seguindo o fluxo original da Play.
 * @param {Object} params
 * @param {Object} params.item - Item fresco do endpoint embed-candidates
 * @param {Object} params.post - Linha da fila embed_posts
 * @param {Object} params.download - Resultado do download do Vimeo
 * @param {string} params.vimeoId
 * @returns {{title:string, description:string, tags:string[], postUrl:string|null}}
 */
export function buildEmbedUploadMetadata({ item = {}, post = {}, download = {}, vimeoId }) {
  return {
    title: item.title || post.title || download.title || `Video ${vimeoId}`,
    description: item.content_clean || download.description || "",
    tags: normalizeTags(item.tags),
    postUrl: item.post_url || post.post_url || null,
  };
}
