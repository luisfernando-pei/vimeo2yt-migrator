import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

const nodeEnv = process.env.NODE_ENV || "qa";
const envFile = nodeEnv === "prod" ? ".env.prod" : ".env.qa";

dotenv.config({ path: envFile });

function must(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name} (from ${envFile})`);
  return v;
}

export const config = {
  appEnv: must("APP_ENV"),
  dbPath: must("DB_PATH"),
  tmpDir: must("TMP_DIR"),
  logFile: must("LOG_FILE"),

  vimeoToken: must("VIMEO_TOKEN"),

  yt: {
    clientId: must("YT_CLIENT_ID"),
    clientSecret: must("YT_CLIENT_SECRET"),
    redirectUri: must("YT_REDIRECT_URI"),
    refreshToken: must("YT_REFRESH_TOKEN"),
    privacyStatus: process.env.YT_PRIVACY_STATUS || "unlisted",
  },

  wp: {
    appUser: must("WP_APP_USER"),
    appPass: must("WP_APP_PASS"),
    baseUrl: must("WP_BASE_URL").replace(/\/$/, ""),
    migrateToken: must("WP_MIGRATE_TOKEN"),
    qaBasicUser: process.env.QA_BASIC_USER || "",
    qaBasicPass: process.env.QA_BASIC_PASS || "",
    batchSize: Number(process.env.BATCH_SIZE || 20),
    postType: process.env.WP_POST_TYPE || "posts",
    metaKey: process.env.WP_META_KEY || "url_do_youtube",
    queryParam: process.env.WP_QUERY_PARAM || "",
    fetchMaxPages: Number(process.env.FETCH_MAX_PAGES || 0),
  },

  worker: {
    concurrency: Number(process.env.CONCURRENCY || 1),
    cleanupOk: process.env.CLEANUP_OK === "1",
    maxAttempts: Number(process.env.MAX_ATTEMPTS || 5),
  },

  quota: {
    // YouTube API v3 daily quota limit (default: 10,000 units)
    dailyLimit: Number(process.env.YT_DAILY_QUOTA_LIMIT || 10000),
    // Each video.insert costs approximately 1600 units
    uploadCost: 1600,
    // Calculate max uploads per day (conservative: 6 uploads with 10k quota)
    get maxUploadsPerDay() {
      return Math.floor(this.dailyLimit / this.uploadCost);
    },
  },
};

export function ensureDirs() {
  for (const p of [path.dirname(config.dbPath), config.tmpDir, "logs"]) {
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  }
}
