import { fetchWpCandidates } from "./wordpress.js";
import { upsertJob } from "./db.js";
import { parseVimeoId } from "./vimeo.js";
import { config } from "./config.js";
import { logger } from "./utils/logger.js";

/**
 * Busca posts do WordPress e adiciona à fila de migração
 * Percorre todas as páginas disponíveis ou até o limite configurado
 * @param {Object} options
 * @param {boolean} [options.force=false] - Forçar reprocessamento de todos os posts
 * @returns {Promise<Object>} Estatísticas da operação
 * @property {number} fetched - Total de posts buscados
 * @property {number} queued - Total de jobs criados
 * @property {number} pages - Páginas processadas
 */
export async function fetchAndQueue({ force = false } = {}) {
  let page = 1;
  let queued = 0;
  let fetchedItems = 0;
  let skipped = 0;

  logger.info(`Starting fetch and queue`, { force, batchSize: config.wp.batchSize });

  while (true) {
    logger.debug(`Fetching page ${page}`);
    
    const data = await fetchWpCandidates({ page, force });
    const items = data.items;

    fetchedItems += items.length;

    let pageQueued = 0;
    for (const it of items) {
      const vimeoId = parseVimeoId(it.vimeo_url);
      if (!vimeoId) {
        logger.warn(`Invalid Vimeo URL, skipping`, { 
          postId: it.id, 
          url: it.vimeo_url 
        });
        skipped++;
        continue;
      }
      
      // Passa title, content, tags, slug e post_url do WordPress para o job
      const result = upsertJob({ 
        wp_post_id: it.id, 
        vimeo_url: it.vimeo_url, 
        vimeo_id: vimeoId,
        title: it.title,
        content: it.content,
        tags: it.tags,
        slug: it.slug,
        post_url: it.post_url
      });
      
      // upsertJob retorna true se inseriu, false se já existia
      if (result) {
        queued++;
        pageQueued++;
      } else {
        skipped++;
      }
    }

    logger.info(`Page ${page} processed`, { 
      items: items.length, 
      queued: pageQueued,
      skipped: items.length - pageQueued,
      totalQueued: queued,
      totalSkipped: skipped
    });

    // Verifica limites de paginação
    if (config.wp.fetchMaxPages > 0 && page >= config.wp.fetchMaxPages) {
      logger.info(`Reached max pages limit`, { maxPages: config.wp.fetchMaxPages });
      break;
    }
    
    if (page >= (data.total_pages || 1)) {
      logger.info(`Reached last page`, { totalPages: data.total_pages });
      break;
    }

    page++;
  }

  logger.info(`Fetch and queue completed`, { 
    fetched: fetchedItems, 
    queued, 
    skipped,
    pages: page 
  });

  return { fetched: fetchedItems, queued, skipped, pages: page };
}
