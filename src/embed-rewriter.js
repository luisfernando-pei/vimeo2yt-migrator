import { Patterns } from "./constants.js";

/** Casa qualquer elemento <iframe ...></iframe> sem conteúdo interno */
const VIMEO_IFRAME_RE = /<iframe\b[^>]*?>\s*<\/iframe>/gi;
/** Casa a tag <script> do player do Vimeo */
const PLAYER_SCRIPT_RE = /<script\b[^>]*\bsrc="https:\/\/player\.vimeo\.com\/api\/player\.js"[^>]*>\s*<\/script>/gi;
/** Formato válido de ID do YouTube */
const YOUTUBE_ID_RE = /^[a-zA-Z0-9_-]+$/;

/**
 * Extrai o valor de um atributo de uma tag HTML.
 * O lookbehind evita casar o sufixo de outro atributo (ex: data-src vs src).
 * @param {string} tag - String da tag
 * @param {string} name - Nome do atributo
 * @returns {string|null}
 */
function getAttr(tag, name) {
  const m = tag.match(new RegExp(`(?<![\\w-])${name}="([^"]*)"`, "i"));
  return m ? m[1] : null;
}

/**
 * Reescreve o post_content trocando os iframes do Vimeo por iframes do YouTube
 * e removendo o <script> do player do Vimeo. Função pura.
 * @param {string} content - HTML original do post_content
 * @param {Object} videoMap - Mapa { vimeoId: youtubeId }
 * @returns {{content: string, replacedIds: string[], missingIds: string[]}}
 *   content - HTML novo
 *   replacedIds - vimeoIds efetivamente trocados
 *   missingIds - vimeoIds achados no conteúdo mas não trocados (ausentes do
 *                videoMap ou com ID do YouTube inválido)
 */
export function rewriteContent(content, videoMap = {}) {
  if (!content || typeof content !== "string") {
    return { content: content || "", replacedIds: [], missingIds: [] };
  }

  const replacedIds = [];
  const missingIds = [];

  let out = content.replace(VIMEO_IFRAME_RE, (iframeTag) => {
    const src = getAttr(iframeTag, "src") || "";
    const idMatch = src.match(Patterns.PLAYER_VIMEO_ID);
    if (!idMatch) return iframeTag; // não é iframe do Vimeo — não mexe

    const vimeoId = idMatch[1];
    const youtubeId = videoMap[vimeoId];
    if (!youtubeId || !YOUTUBE_ID_RE.test(youtubeId)) {
      if (!missingIds.includes(vimeoId)) missingIds.push(vimeoId);
      return iframeTag; // não resolvido ou ID inválido — deixa intacto
    }

    if (!replacedIds.includes(vimeoId)) replacedIds.push(vimeoId);
    const style = getAttr(iframeTag, "style");
    const styleAttr = style ? ` style="${style}"` : "";
    return `<iframe${styleAttr} src="https://www.youtube.com/embed/${youtubeId}" frameborder="0" allowfullscreen></iframe>`;
  });

  out = out.replace(PLAYER_SCRIPT_RE, "");
  out = out.replace(/\n{3,}/g, "\n\n");

  return { content: out, replacedIds, missingIds };
}
