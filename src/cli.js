import { ensureDirs, config } from "./config.js";
import { fetchAndQueue } from "./fetcher.js";
import { runWorkerLoop } from "./worker.js";
import { stats } from "./db.js";

ensureDirs();

const cmd = process.argv[2];
const force = process.argv.includes("--force");

// Busca por --limit=N
const limitArg = process.argv.find(arg => arg.startsWith("--limit="));
if (limitArg) {
  const limit = parseInt(limitArg.split("=")[1], 10);
  if (!isNaN(limit)) {
    config.worker.maxJobsPerRun = limit;
  }
}

if (!cmd || !["fetch", "migrate", "status"].includes(cmd)) {
  console.log("Usage: node src/cli.js <fetch|migrate|status> [--force] [--limit=N]");
  process.exit(1);
}

console.log(`ENV=${config.appEnv} DB=${config.dbPath}`);

if (cmd === "fetch") {
  const r = await fetchAndQueue({ force });
  console.log(r);
}

if (cmd === "migrate") {
  await runWorkerLoop();
  console.log("Done loop.");
}

if (cmd === "status") {
  console.log(stats());
}

// node src/cli.js fetch --force

