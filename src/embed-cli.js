import fs from "node:fs";
import { config } from "./config.js";
import { createEmbedDb } from "./embed-db.js";
import { scanAndQueue } from "./embed-fetcher.js";
import { runEmbedWorkerLoop } from "./embed-worker.js";

// Garante diretórios necessários
for (const d of ["data", config.tmpDir]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

const cmd = process.argv[2];
const dryRun = process.argv.includes("--dry-run");
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) || 0 : 0;

if (!cmd || !["scan", "migrate", "status"].includes(cmd)) {
  console.log("Usage: node src/embed-cli.js <scan|migrate|status> [--dry-run] [--limit=N]");
  process.exit(1);
}

console.log(`ENV=${config.appEnv} DB=${config.dbPath}`);

const embedDb = createEmbedDb(config.dbPath, config.worker.maxAttempts);

if (cmd === "scan") {
  const r = await scanAndQueue(embedDb);
  console.log(r);
}

if (cmd === "migrate") {
  const r = await runEmbedWorkerLoop(embedDb, { dryRun, limit });
  console.log(r);
}

if (cmd === "status") {
  console.log(embedDb.embedStats());
}

embedDb.close();
// O googleapis mantém handles HTTP abertos; encerra explicitamente.
process.exit(0);
