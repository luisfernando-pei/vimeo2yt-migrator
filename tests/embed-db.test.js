import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { createEmbedDb } from "../src/embed-db.js";

function tmpDbPath() {
  return path.join(os.tmpdir(), `embed-test-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
}

function cleanup(p) {
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(p + suffix, { force: true });
  }
}

test("resolveYoutubeId devolve null quando nada casa", () => {
  const p = tmpDbPath();
  const edb = createEmbedDb(p);
  assert.strictEqual(edb.resolveYoutubeId("999"), null);
  edb.close();
  cleanup(p);
});

test("resolveYoutubeId acha video gravado no video_map", () => {
  const p = tmpDbPath();
  const edb = createEmbedDb(p);
  edb.recordVideoMap({ vimeo_id: "111", youtube_id: "ytABC", youtube_url: "https://youtu.be/ytABC" });
  const r = edb.resolveYoutubeId("111");
  assert.strictEqual(r.youtubeId, "ytABC");
  assert.strictEqual(r.source, "reuse:embed");
  edb.close();
  cleanup(p);
});

test("resolveYoutubeId acha video da tabela jobs da migracao Play", () => {
  const p = tmpDbPath();
  const raw = new Database(p);
  raw.exec("CREATE TABLE jobs (id INTEGER PRIMARY KEY, vimeo_id TEXT, youtube_id TEXT, youtube_url TEXT)");
  raw.prepare("INSERT INTO jobs (vimeo_id, youtube_id, youtube_url) VALUES (?,?,?)")
    .run("222", "ytPLAY", "https://youtu.be/ytPLAY");
  raw.close();

  const edb = createEmbedDb(p);
  const r = edb.resolveYoutubeId("222");
  assert.strictEqual(r.youtubeId, "ytPLAY");
  assert.strictEqual(r.source, "reuse:play");
  edb.close();
  cleanup(p);
});

test("upsertEmbedPost insere uma vez e ignora duplicata", () => {
  const p = tmpDbPath();
  const edb = createEmbedDb(p);
  const first = edb.upsertEmbedPost({ wp_post_id: 500, title: "T", post_url: "u", post_date: "2024-01-01 00:00:00", video_count: 2 });
  const second = edb.upsertEmbedPost({ wp_post_id: 500, title: "T", post_url: "u", post_date: "2024-01-01 00:00:00", video_count: 2 });
  assert.strictEqual(first, true);
  assert.strictEqual(second, false);
  assert.deepStrictEqual(edb.embedStats(), { queued: 1 });
  edb.close();
  cleanup(p);
});

test("nextEmbedPost pega a materia mais antiga primeiro", () => {
  const p = tmpDbPath();
  const edb = createEmbedDb(p);
  edb.upsertEmbedPost({ wp_post_id: 1, title: "novo", post_url: "u", post_date: "2024-05-01 00:00:00", video_count: 1 });
  edb.upsertEmbedPost({ wp_post_id: 2, title: "antigo", post_url: "u", post_date: "2023-01-01 00:00:00", video_count: 1 });
  const next = edb.nextEmbedPost();
  assert.strictEqual(next.wp_post_id, 2);
  edb.close();
  cleanup(p);
});

test("resolveYoutubeId enxerga a tabela jobs criada apos o factory", () => {
  const p = tmpDbPath();
  const edb = createEmbedDb(p);
  edb.db.exec("CREATE TABLE jobs (id INTEGER PRIMARY KEY, vimeo_id TEXT, youtube_id TEXT, youtube_url TEXT)");
  edb.db.prepare("INSERT INTO jobs (vimeo_id, youtube_id, youtube_url) VALUES (?,?,?)")
    .run("333", "ytLATE", "https://youtu.be/ytLATE");
  const r = edb.resolveYoutubeId("333");
  assert.strictEqual(r.youtubeId, "ytLATE");
  assert.strictEqual(r.source, "reuse:play");
  edb.close();
  cleanup(p);
});
