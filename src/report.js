// src/report.js
import fs from "node:fs";
import path from "node:path";

function csvEscape(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function appendMappingRow({
  env,
  jobId,
  wpPostId,
  vimeoId,
  vimeoUrl,
  vimeoTitle,
  youtubeId,
  youtubeUrl,
  status,
  note,
}) {
  const outDir = path.resolve("./data");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const file = path.join(outDir, `mapping.${env}.csv`);

  const header =
    "ts_utc,env,job_id,wp_post_id,vimeo_id,vimeo_url,vimeo_title,youtube_id,youtube_url,status,note\n";

  if (!fs.existsSync(file)) fs.writeFileSync(file, header, "utf8");

  const row = [
    new Date().toISOString(),
    env,
    jobId,
    wpPostId,
    vimeoId,
    vimeoUrl,
    vimeoTitle,
    youtubeId,
    youtubeUrl,
    status,
    note || "",
  ]
    .map(csvEscape)
    .join(",") + "\n";

  fs.appendFileSync(file, row, "utf8");
}