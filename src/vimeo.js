import axios from "axios";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { makeSpeedMeter, eta } from "./metrics.js";

export function parseVimeoId(url) {
  // padrões:
  // https://vimeo.com/887028319/
  // https://vimeo.com/888452457/3705d4f6e5
  const m = String(url).match(/vimeo\.com\/(\d+)/);
  return m ? m[1] : null;
}
export async function getVimeoDownloadUrl(vimeoId) {
  // Vimeo API: /videos/{video_id}
  const res = await axios.get(`https://api.vimeo.com/videos/${vimeoId}`, {
    headers: { Authorization: `Bearer ${config.vimeoToken}` },
  });

  // "download" nem sempre vem; quando vem, costuma ser uma lista com links e tamanhos
  const v = res.data;
  const download = v.download;
  const title = v?.name || `Video ${vimeoId}`;
  const description = v?.description || "";
  const duration = v?.duration || null;
  const vimeoUrl = v?.link || `https://vimeo.com/${vimeoId}`;
 
  if (Array.isArray(download) && download.length) {
    // Preferir maior MP4 (ou melhor quality)
    const sorted = [...download].sort((a, b) => (b.size || 0) - (a.size || 0));
    return {
      url: sorted[0].link,
      size: sorted[0].size || null,
      quality: sorted[0].quality || null,
      title,
      description,
      duration,
      vimeoUrl,
    };
  }

  // fallback: tentar files.progressive (streams mp4)
  const progressive = res.data.files?.progressive;
  if (Array.isArray(progressive) && progressive.length) {
    const sorted = [...progressive].sort((a, b) => (b.width || 0) - (a.width || 0));
    return {
      url: sorted[0].url,
      size: null,
      quality: `${sorted[0].quality || ""}`.trim() || null,
      title,
      description,
      duration,
      vimeoUrl,
    };
  }

  throw new Error(`Vimeo video ${vimeoId} has no download/progressive links available (check permissions)`);
}

export async function downloadVimeoToFile({ vimeoId, outDir }) {
  const info = await getVimeoDownloadUrl(vimeoId);

  const filename = `vimeo_${vimeoId}.mp4`;
  const outPath = path.join(outDir, filename);

  const meter = makeSpeedMeter();

  const resp = await axios.get(info.url, { responseType: "stream" });

  const total = Number(resp.headers["content-length"] || info.size || 0);
  let lastLog = Date.now();

  await new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(outPath);

    resp.data.on("data", (chunk) => {
      meter.tick(chunk.length);
      if (Date.now() - lastLog > 2000) {
        lastLog = Date.now();
        if (total > 0) {
          const s = meter.snapshot();
          const leftBytes = total - s.bytes;
          const secLeft = s.bps > 0 ? leftBytes / s.bps : Infinity;
          process.stdout.write(
            `\rDL ${vimeoId}: ${(s.bytes/1024/1024).toFixed(1)} / ${(total/1024/1024).toFixed(1)} MB ` +
            `@ ${s.mbps.toFixed(2)} MB/s ETA ${eta(secLeft)}      `
          );
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

  process.stdout.write("\n");

  const fileSize = fs.statSync(outPath).size;
  
  return { 
      outPath, 
      fileSize, 
      quality: info.quality,
      title: info.title,
      description: info.description,
      duration: info.duration,
      vimeoUrl: info.vimeoUrl
   };
}