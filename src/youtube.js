import fs from "node:fs";
import { google } from "googleapis";
import { config } from "./config.js";
import { makeSpeedMeter } from "./metrics.js";

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

function youtubeClient() {
  const oauth2 = new google.auth.OAuth2(
    config.yt.clientId,
    config.yt.clientSecret,
    config.yt.redirectUri
  );

  oauth2.setCredentials({ refresh_token: config.yt.refreshToken });

  return google.youtube({ version: "v3", auth: oauth2 });
}

export async function uploadToYouTube({ filePath, title, description, vimeoUrl, vimeoId, wpPostId }) {
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
          categoryId: "22" // People & Blogs (padrão ok)
        },
        status: {
          privacyStatus: config.yt.privacyStatus || "unlisted",
          selfDeclaredMadeForKids: false,   // ✅ NÃO é para crianças
        }
      },
      media: {
        body: fs.createReadStream(filePath).on("data", (chunk) => {
          meter.tick(chunk.length);
          if (Date.now() - lastLog > 2000) {
            lastLog = Date.now();
            const s = meter.snapshot();
            const pct = (s.bytes / fileSize) * 100;
            process.stdout.write(
              `\rUP: ${pct.toFixed(1)}% (${(s.bytes/1024/1024).toFixed(1)} / ${(fileSize/1024/1024).toFixed(1)} MB) ` +
              `@ ${s.mbps.toFixed(2)} MB/s      `
            );
          }
        })
      }
    },
    {
      // importante para upload grande
      onUploadProgress: () => {}
    }
  );

  process.stdout.write("\n");

  const youtubeId = res.data.id;
  if (!youtubeId) throw new Error("YouTube upload succeeded but no video id returned");

  const youtubeUrl = `https://youtu.be/${youtubeId}`;
  return { youtubeId, youtubeUrl };
}