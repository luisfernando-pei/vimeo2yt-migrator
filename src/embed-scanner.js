import { Patterns } from "./constants.js";

/**
 * Extrai todos os IDs de vídeo do Vimeo de URLs player.vimeo.com/video/<id>
 * presentes num HTML. Devolve uma lista única, na ordem de aparição.
 * @param {string} content - HTML do post_content
 * @returns {string[]} IDs do Vimeo (strings), sem duplicatas
 */
export function extractVimeoIds(content) {
  if (!content || typeof content !== "string") return [];
  const re = new RegExp(Patterns.PLAYER_VIMEO_ID.source, "g");
  const ids = [];
  for (const m of content.matchAll(re)) {
    if (!ids.includes(m[1])) ids.push(m[1]);
  }
  return ids;
}
