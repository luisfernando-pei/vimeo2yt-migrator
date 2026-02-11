import { fetchWpCandidates } from "./wordpress.js";
import { upsertJob } from "./db.js";
import { parseVimeoId } from "./vimeo.js";
import { config } from "./config.js";

export async function fetchAndQueue({ force = false } = {}) {
  let page = 1;
  let queued = 0;
  let fetchedItems = 0;

  while (true) {
    const data = await fetchWpCandidates({ page, force });
    const items = data.items;

    fetchedItems += items.length;

    for (const it of items) {
      const vimeoId = parseVimeoId(it.vimeo_url);
      if (!vimeoId) continue;
      upsertJob({ wp_post_id: it.id, vimeo_url: it.vimeo_url, vimeo_id: vimeoId });
      queued++;
    }

    if (config.wp.fetchMaxPages > 0 && page >= config.wp.fetchMaxPages) break;
    if (page >= (data.total_pages || 1)) break;

    page++;
  }

  return { fetched: fetchedItems, queued, pages: page };
}