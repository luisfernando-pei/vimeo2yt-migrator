# Migração de Vídeos do Vimeo Embedados — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir um CLI separado (`scan`/`migrate`) que migra para o YouTube os vídeos do Vimeo embedados no `post_content` das matérias do WordPress, reescrevendo o iframe.

**Architecture:** CLI Node.js novo (`src/embed-cli.js`) que reusa os módulos testados do migrador da seção Play (`vimeo.js`, `youtube.js`, `logger.js`, `metrics.js`). Duas fases: `scan` (descobre matérias com iframe do Vimeo, monta fila no SQLite, gera CSV) e `migrate` (resolve dedup, baixa/sobe os que faltam, reescreve o conteúdo). O plugin WordPress ganha 2 endpoints novos: listar matérias com embed e gravar o conteúdo novo driblando o kses.

**Tech Stack:** Node.js 18+ (ESM), better-sqlite3, axios, googleapis, `node --test` para testes, PHP (plugin WordPress).

**Nota sobre arquivos:** o spec lista 6 módulos novos. Este plano adiciona um sétimo, `src/embed-fetcher.js`, separando a função pura de parsing (`embed-scanner.js`) da orquestração do `scan` (`embed-fetcher.js`). Isso espelha a separação `vimeo.js`/`fetcher.js` da Play e mantém o parser testável sem carregar `config.js`.

**Referência:** spec em `docs/superpowers/specs/2026-05-20-embedded-video-migration-design.md`.

---

## Estrutura de arquivos

| Arquivo | Tipo | Responsabilidade |
|---------|------|------------------|
| `src/constants.js` | Modificar | Adicionar regex `PLAYER_VIMEO_ID` e enum `EmbedJobStatus` |
| `src/embed-scanner.js` | Criar | **Puro:** `extractVimeoIds(content)` — extrai IDs do Vimeo do HTML |
| `src/embed-rewriter.js` | Criar | **Puro:** `rewriteContent(content, videoMap)` — troca os iframes |
| `src/embed-db.js` | Criar | `createEmbedDb(path)` — fábrica do acesso ao SQLite (tabelas novas + dedup) |
| `src/embed-wordpress.js` | Criar | Cliente HTTP dos 2 endpoints novos do plugin |
| `src/embed-fetcher.js` | Criar | `scanAndQueue(embedDb)` — orquestração da fase `scan` + CSV |
| `src/embed-worker.js` | Criar | `migrateEmbedPost` / `runEmbedWorkerLoop` — orquestração da fase `migrate` |
| `src/embed-cli.js` | Criar | Entrypoint. Comandos `scan` / `migrate` / `status` |
| `package.json` | Modificar | 3 scripts npm novos |
| `plugin-vimeo2yt-migrate.php` | Modificar | 2 endpoints novos, versão → 2.2.0 |
| `tests/embed-scanner.test.js` | Criar | Testes de `extractVimeoIds` |
| `tests/embed-rewriter.test.js` | Criar | Testes de `rewriteContent` |
| `tests/embed-db.test.js` | Criar | Testes da resolução de dedup |

---

## Task 1: Constantes — regex de player e enum de status

**Files:**
- Modify: `src/constants.js`

- [ ] **Step 1: Adicionar o regex `PLAYER_VIMEO_ID` ao objeto `Patterns`**

Em `src/constants.js`, dentro do objeto `Patterns`, logo após a linha do `VIMEO_ID`, adicionar a entrada nova. O bloco deve ficar assim:

```js
export const Patterns = {
  /** Extrair ID do Vimeo de URL */
  VIMEO_ID: /vimeo\.com\/(\d+)/,
  /** Extrair ID do Vimeo de URL de player embedado (player.vimeo.com/video/ID) */
  PLAYER_VIMEO_ID: /player\.vimeo\.com\/video\/(\d+)/,
  /** ID do YouTube em URL youtu.be */
  YOUTUBE_SHORT_URL: /youtu\.be\/([a-zA-Z0-9_-]+)/,
  /** ID do YouTube em URL youtube.com/watch */
  YOUTUBE_WATCH_URL: /[?&]v=([a-zA-Z0-9_-]+)/,
};
```

- [ ] **Step 2: Adicionar o enum `EmbedJobStatus`**

Em `src/constants.js`, logo após o bloco `export const JobStatus = { ... };`, adicionar:

```js
/**
 * Status possíveis de uma matéria na migração de vídeos embedados
 * @readonly
 * @enum {string}
 */
export const EmbedJobStatus = {
  QUEUED: "queued",
  PROCESSING: "processing",
  DONE: "done",
  FAILED: "failed",
  NO_VIDEOS: "no_videos",
};
```

- [ ] **Step 3: Verificar que o módulo carrega e expõe os símbolos novos**

Run: `node -e "import('./src/constants.js').then(m => { console.log(String(m.Patterns.PLAYER_VIMEO_ID)); console.log(JSON.stringify(m.EmbedJobStatus)); })"`
Expected: imprime `/player\.vimeo\.com\/video\/(\d+)/` e `{"QUEUED":"queued","PROCESSING":"processing","DONE":"done","FAILED":"failed","NO_VIDEOS":"no_videos"}`

- [ ] **Step 4: Commit**

```bash
git add src/constants.js
git commit -m "feat: adiciona regex de player do Vimeo e enum EmbedJobStatus"
```

---

## Task 2: Parser — `extractVimeoIds`

Função pura que extrai os IDs de vídeo de todas as URLs `player.vimeo.com/video/<id>` num HTML.

**Files:**
- Create: `src/embed-scanner.js`
- Test: `tests/embed-scanner.test.js`

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/embed-scanner.test.js`:

```js
import test from "node:test";
import assert from "node:assert";
import { extractVimeoIds } from "../src/embed-scanner.js";

const EX1 = '<div style="padding: 56.25% 0 0 0; position: relative;"><iframe style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;" title="EP_TBOL_MARCELLO DANTAS_V3" src="https://player.vimeo.com/video/1110143545?badge=0&amp;autopause=0&amp;player_id=0&amp;app_id=58479" frameborder="0" data-mce-fragment="1"></iframe></div>\n<script src="https://player.vimeo.com/api/player.js"></script>';

test("extractVimeoIds acha o id num bloco de embed real", () => {
  assert.deepStrictEqual(extractVimeoIds(EX1), ["1110143545"]);
});

test("extractVimeoIds acha varios ids distintos", () => {
  const content = EX1 + "\n" + EX1.replace("1110143545", "1114259324");
  assert.deepStrictEqual(extractVimeoIds(content), ["1110143545", "1114259324"]);
});

test("extractVimeoIds remove ids repetidos", () => {
  const content = EX1 + "\n" + EX1;
  assert.deepStrictEqual(extractVimeoIds(content), ["1110143545"]);
});

test("extractVimeoIds devolve vazio para conteudo sem Vimeo", () => {
  assert.deepStrictEqual(extractVimeoIds("<p>hello world</p>"), []);
});

test("extractVimeoIds trata entrada null/vazia", () => {
  assert.deepStrictEqual(extractVimeoIds(null), []);
  assert.deepStrictEqual(extractVimeoIds(""), []);
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `node --test tests/embed-scanner.test.js`
Expected: FAIL — `Cannot find module '.../src/embed-scanner.js'`

- [ ] **Step 3: Implementar `src/embed-scanner.js`**

Criar `src/embed-scanner.js`:

```js
import { Patterns } from "./constants.js";

/**
 * Extrai todos os IDs de vídeo do Vimeo de URLs player.vimeo.com/video/<id>
 * presentes num HTML. Devolve uma lista única, na ordem de aparição.
 * @param {string} content - HTML do post_content
 * @returns {string[]} IDs do Vimeo (strings), sem duplicatas
 */
export function extractVimeoIds(content) {
  if (!content || typeof content !== "string") return [];
  const re = new RegExp(Patterns.PLAYER_VIMEO_ID.source, "g");
  const ids = [];
  for (const m of content.matchAll(re)) {
    if (!ids.includes(m[1])) ids.push(m[1]);
  }
  return ids;
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `node --test tests/embed-scanner.test.js`
Expected: PASS — 5 testes passam

- [ ] **Step 5: Commit**

```bash
git add src/embed-scanner.js tests/embed-scanner.test.js
git commit -m "feat: adiciona extractVimeoIds para parsear iframes do Vimeo"
```

---

## Task 3: Rewriter — `rewriteContent`

Função pura que troca cada iframe do Vimeo por um iframe do YouTube e remove o `<script>` do player do Vimeo.

**Files:**
- Create: `src/embed-rewriter.js`
- Test: `tests/embed-rewriter.test.js`

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/embed-rewriter.test.js`:

```js
import test from "node:test";
import assert from "node:assert";
import { rewriteContent } from "../src/embed-rewriter.js";
import { extractVimeoIds } from "../src/embed-scanner.js";

const EX1 = '<div style="padding: 56.25% 0 0 0; position: relative;"><iframe style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;" title="EP_TBOL_MARCELLO DANTAS_V3" src="https://player.vimeo.com/video/1110143545?badge=0&amp;autopause=0&amp;player_id=0&amp;app_id=58479" frameborder="0" data-mce-fragment="1"></iframe></div>\n<script src="https://player.vimeo.com/api/player.js"></script>';

test("rewriteContent troca o iframe do Vimeo por um do YouTube", () => {
  const { content, replacedIds, missingIds } = rewriteContent(EX1, { "1110143545": "ytABC" });
  assert.ok(content.includes('src="https://www.youtube.com/embed/ytABC"'));
  assert.ok(!content.includes("player.vimeo.com"));
  assert.deepStrictEqual(replacedIds, ["1110143545"]);
  assert.deepStrictEqual(missingIds, []);
});

test("rewriteContent mantem a div wrapper responsiva", () => {
  const { content } = rewriteContent(EX1, { "1110143545": "ytABC" });
  assert.ok(content.includes("padding: 56.25% 0 0 0"));
});

test("rewriteContent mantem o style de posicionamento do iframe", () => {
  const { content } = rewriteContent(EX1, { "1110143545": "ytABC" });
  assert.ok(content.includes("position: absolute"));
});

test("rewriteContent remove a tag script do player.js do Vimeo", () => {
  const { content } = rewriteContent(EX1, { "1110143545": "ytABC" });
  assert.ok(!content.includes("player.js"));
});

test("rewriteContent gera conteudo sem nenhum embed do Vimeo (idempotencia)", () => {
  const { content } = rewriteContent(EX1, { "1110143545": "ytABC" });
  assert.deepStrictEqual(extractVimeoIds(content), []);
});

test("rewriteContent trata varios videos na mesma materia", () => {
  const two = EX1 + "\n<p>meio</p>\n" + EX1.replace("1110143545", "1114259324");
  const { content, replacedIds } = rewriteContent(two, { "1110143545": "ytA", "1114259324": "ytB" });
  assert.ok(content.includes("https://www.youtube.com/embed/ytA"));
  assert.ok(content.includes("https://www.youtube.com/embed/ytB"));
  assert.ok(!content.includes("player.vimeo.com"));
  assert.deepStrictEqual(replacedIds.sort(), ["1110143545", "1114259324"]);
});

test("rewriteContent reporta ids nao resolvidos e nao mexe neles", () => {
  const { content, replacedIds, missingIds } = rewriteContent(EX1, {});
  assert.deepStrictEqual(missingIds, ["1110143545"]);
  assert.deepStrictEqual(replacedIds, []);
  assert.ok(content.includes("player.vimeo.com/video/1110143545"));
});

test("rewriteContent deixa conteudo sem Vimeo inalterado", () => {
  const html = "<p>nada aqui</p>";
  const { content, replacedIds, missingIds } = rewriteContent(html, {});
  assert.strictEqual(content, html);
  assert.deepStrictEqual(replacedIds, []);
  assert.deepStrictEqual(missingIds, []);
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `node --test tests/embed-rewriter.test.js`
Expected: FAIL — `Cannot find module '.../src/embed-rewriter.js'`

- [ ] **Step 3: Implementar `src/embed-rewriter.js`**

Criar `src/embed-rewriter.js`:

```js
import { Patterns } from "./constants.js";

/** Casa qualquer elemento <iframe ...></iframe> sem conteúdo interno */
const VIMEO_IFRAME_RE = /<iframe\b[^>]*?>\s*<\/iframe>/gi;
/** Casa a tag <script> do player do Vimeo */
const PLAYER_SCRIPT_RE = /<script\b[^>]*\bsrc="https:\/\/player\.vimeo\.com\/api\/player\.js"[^>]*>\s*<\/script>/gi;

/**
 * Extrai o valor de um atributo de uma tag HTML.
 * @param {string} tag - String da tag
 * @param {string} name - Nome do atributo
 * @returns {string|null}
 */
function getAttr(tag, name) {
  const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`, "i"));
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
 *   missingIds - vimeoIds achados no conteúdo mas ausentes do videoMap
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
    if (!youtubeId) {
      if (!missingIds.includes(vimeoId)) missingIds.push(vimeoId);
      return iframeTag; // não resolvido — deixa intacto
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
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `node --test tests/embed-rewriter.test.js`
Expected: PASS — 8 testes passam

- [ ] **Step 5: Commit**

```bash
git add src/embed-rewriter.js tests/embed-rewriter.test.js
git commit -m "feat: adiciona rewriteContent para trocar iframe Vimeo por YouTube"
```

---

## Task 4: Acesso ao banco — `createEmbedDb`

Fábrica do acesso ao SQLite: cria as tabelas `embed_posts` e `video_map`, gerencia a fila e a resolução de dedup. Não importa `config.js` (recebe o caminho por parâmetro) para ser testável sem variáveis de ambiente.

**Files:**
- Create: `src/embed-db.js`
- Test: `tests/embed-db.test.js`

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/embed-db.test.js`:

```js
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
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `node --test tests/embed-db.test.js`
Expected: FAIL — `Cannot find module '.../src/embed-db.js'`

- [ ] **Step 3: Implementar `src/embed-db.js`**

Criar `src/embed-db.js`:

```js
import Database from "better-sqlite3";
import { DatabaseConfig, EmbedJobStatus, RetryConfig } from "./constants.js";

/**
 * Cria as tabelas da migração de embedados, se não existirem.
 * @param {Database} db
 */
function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS embed_posts (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      wp_post_id  INTEGER NOT NULL UNIQUE,
      title       TEXT,
      post_url    TEXT,
      post_date   TEXT,
      status      TEXT NOT NULL DEFAULT 'queued',
      attempts    INTEGER NOT NULL DEFAULT 0,
      video_count INTEGER NOT NULL DEFAULT 0,
      error       TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_embed_posts_status ON embed_posts(status);

    CREATE TABLE IF NOT EXISTS video_map (
      vimeo_id       TEXT PRIMARY KEY,
      youtube_id     TEXT NOT NULL,
      youtube_url    TEXT NOT NULL,
      vimeo_name     TEXT,
      source_post_id INTEGER,
      created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

/**
 * Verifica se a tabela `jobs` (migração da seção Play) existe no banco.
 * @param {Database} db
 * @returns {boolean}
 */
function jobsTableExists(db) {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='jobs'")
    .get();
  return Boolean(row);
}

/**
 * Cria o acesso ao banco da migração de vídeos embedados.
 * @param {string} dbPath - Caminho do arquivo SQLite
 * @param {number} [maxAttempts] - Máximo de tentativas por matéria
 * @returns {Object} API do banco
 */
export function createEmbedDb(dbPath, maxAttempts = RetryConfig.MAX_ATTEMPTS) {
  const db = new Database(dbPath);
  db.pragma(`journal_mode = ${DatabaseConfig.JOURNAL_MODE}`);
  db.pragma(`busy_timeout = ${DatabaseConfig.BUSY_TIMEOUT_MS}`);
  initSchema(db);
  const hasJobs = jobsTableExists(db);

  return {
    /** Handle bruto do better-sqlite3 (usado por testes). */
    db,

    /**
     * Insere uma matéria na fila. Ignora se já existir (não re-enfileira).
     * @returns {boolean} true se inseriu, false se já existia
     */
    upsertEmbedPost({ wp_post_id, title, post_url, post_date, video_count }) {
      const r = db
        .prepare(
          `INSERT INTO embed_posts (wp_post_id, title, post_url, post_date, video_count, status)
           VALUES (?, ?, ?, ?, ?, '${EmbedJobStatus.QUEUED}')
           ON CONFLICT(wp_post_id) DO NOTHING`
        )
        .run(wp_post_id, title || null, post_url || null, post_date || null, video_count || 0);
      return r.changes > 0;
    },

    /**
     * Próxima matéria a processar (queued/failed, mais antiga primeiro).
     * @returns {Object|null}
     */
    nextEmbedPost() {
      return (
        db
          .prepare(
            `SELECT * FROM embed_posts
             WHERE status IN ('${EmbedJobStatus.QUEUED}','${EmbedJobStatus.FAILED}')
               AND attempts < ?
             ORDER BY post_date ASC, id ASC
             LIMIT 1`
          )
          .get(maxAttempts) || null
      );
    },

    /**
     * Todas as matérias pendentes (queued/failed), mais antiga primeiro.
     * @returns {Object[]}
     */
    pendingEmbedPosts() {
      return db
        .prepare(
          `SELECT * FROM embed_posts
           WHERE status IN ('${EmbedJobStatus.QUEUED}','${EmbedJobStatus.FAILED}')
             AND attempts < ?
           ORDER BY post_date ASC, id ASC`
        )
        .all(maxAttempts);
    },

    /**
     * Atualiza status e campos extras de uma matéria.
     * @param {number} id
     * @param {string} status
     * @param {Object} [patch]
     */
    setEmbedPostStatus(id, status, patch = {}) {
      const fields = { ...patch, status, updated_at: new Date().toISOString() };
      const cols = Object.keys(fields);
      const setSql = cols.map((c) => `${c} = ?`).join(", ");
      db.prepare(`UPDATE embed_posts SET ${setSql} WHERE id = ?`).run(
        ...cols.map((c) => fields[c]),
        id
      );
    },

    /** Incrementa o contador de tentativas de uma matéria. */
    incEmbedPostAttempts(id) {
      db.prepare(
        `UPDATE embed_posts SET attempts = attempts + 1, updated_at = ? WHERE id = ?`
      ).run(new Date().toISOString(), id);
    },

    /**
     * Contagem de matérias por status.
     * @returns {Object}
     */
    embedStats() {
      const rows = db
        .prepare(`SELECT status, COUNT(*) AS n FROM embed_posts GROUP BY status`)
        .all();
      return Object.fromEntries(rows.map((r) => [r.status, r.n]));
    },

    /**
     * Resolve um vimeo_id para um vídeo já no YouTube.
     * Procura no video_map (esta migração) e na tabela jobs (migração Play).
     * @param {string} vimeoId
     * @returns {{youtubeId: string, youtubeUrl: string, source: string}|null}
     */
    resolveYoutubeId(vimeoId) {
      const fromMap = db
        .prepare(`SELECT youtube_id, youtube_url FROM video_map WHERE vimeo_id = ?`)
        .get(String(vimeoId));
      if (fromMap) {
        return {
          youtubeId: fromMap.youtube_id,
          youtubeUrl: fromMap.youtube_url,
          source: "reuse:embed",
        };
      }
      if (hasJobs) {
        const fromJobs = db
          .prepare(
            `SELECT youtube_id, youtube_url FROM jobs
             WHERE vimeo_id = ? AND youtube_url IS NOT NULL AND youtube_url != ''
             LIMIT 1`
          )
          .get(String(vimeoId));
        if (fromJobs) {
          return {
            youtubeId: fromJobs.youtube_id,
            youtubeUrl: fromJobs.youtube_url,
            source: "reuse:play",
          };
        }
      }
      return null;
    },

    /**
     * Registra um vídeo migrado no video_map (ledger de dedup).
     * Ignora se o vimeo_id já estiver registrado.
     */
    recordVideoMap({ vimeo_id, youtube_id, youtube_url, vimeo_name, source_post_id }) {
      db.prepare(
        `INSERT INTO video_map (vimeo_id, youtube_id, youtube_url, vimeo_name, source_post_id)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(vimeo_id) DO NOTHING`
      ).run(
        String(vimeo_id),
        youtube_id,
        youtube_url,
        vimeo_name || null,
        source_post_id || null
      );
    },

    /** Fecha a conexão com o banco. */
    close() {
      db.close();
    },
  };
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `node --test tests/embed-db.test.js`
Expected: PASS — 5 testes passam

- [ ] **Step 5: Commit**

```bash
git add src/embed-db.js tests/embed-db.test.js
git commit -m "feat: adiciona createEmbedDb com fila e resolucao de dedup"
```

---

## Task 5: Cliente WordPress — `embed-wordpress.js`

Cliente HTTP dos 2 endpoints novos do plugin. Sem teste unitário (depende de rede); validado por lint e pela validação end-to-end da Task 10.

**Files:**
- Create: `src/embed-wordpress.js`

- [ ] **Step 1: Implementar `src/embed-wordpress.js`**

Criar `src/embed-wordpress.js`:

```js
import axios from "axios";
import { config } from "./config.js";
import { logger } from "./utils/logger.js";

/**
 * Monta os headers de autenticação para os endpoints de migração.
 * @returns {Object}
 */
function wpHeaders() {
  const h = { "X-Migrate-Token": config.wp.migrateToken };
  if (config.wp.qaBasicUser && config.wp.qaBasicPass) {
    const t = Buffer.from(`${config.wp.qaBasicUser}:${config.wp.qaBasicPass}`).toString("base64");
    h["Authorization"] = `Basic ${t}`;
  }
  return h;
}

/**
 * Busca matérias com vídeo do Vimeo embedado no conteúdo.
 * Se `postId` for informado, busca só aquela matéria (conteúdo fresco).
 * @param {Object} params
 * @param {number} [params.page=1]
 * @param {number} [params.perPage]
 * @param {number} [params.postId]
 * @returns {Promise<{page:number, per_page:number, total:number, total_pages:number, items:Array}>}
 */
export async function fetchEmbedCandidates({ page = 1, perPage, postId } = {}) {
  const params = new URLSearchParams();
  if (postId) {
    params.set("post_id", String(postId));
  } else {
    params.set("page", String(page));
    params.set("per_page", String(perPage ?? config.wp.batchSize));
  }
  const url = `${config.wp.baseUrl}/wp-json/migrate/v1/embed-candidates?${params.toString()}`;

  logger.debug(`Fetching embed candidates`, { page, postId });
  const res = await axios.get(url, { headers: wpHeaders() });

  const data = res.data;
  if (!data || !Array.isArray(data.items)) {
    throw new Error("Unexpected response from embed-candidates endpoint");
  }
  return data;
}

/**
 * Grava o post_content novo de uma matéria.
 * @param {Object} params
 * @param {number} params.postId
 * @param {string} params.content
 * @returns {Promise<Object>}
 */
export async function updatePostContent({ postId, content }) {
  const url = `${config.wp.baseUrl}/wp-json/migrate/v1/update-content`;

  const res = await axios.post(
    url,
    { post_id: postId, content },
    { headers: { ...wpHeaders(), "Content-Type": "application/json" } }
  );

  if (!res.data || res.data.ok !== true) {
    throw new Error(`update-content failed: ${JSON.stringify(res.data)}`);
  }
  logger.info(`WordPress content updated`, { postId });
  return res.data;
}
```

- [ ] **Step 2: Verificar sintaxe**

Run: `node --check src/embed-wordpress.js`
Expected: sem saída (sintaxe OK)

- [ ] **Step 3: Rodar o lint**

Run: `npm run lint`
Expected: PASS — sem erros do eslint

- [ ] **Step 4: Commit**

```bash
git add src/embed-wordpress.js
git commit -m "feat: adiciona cliente WordPress dos endpoints de embed"
```

---

## Task 6: Orquestração do scan — `embed-fetcher.js`

Pagina o endpoint `embed-candidates`, monta a fila no SQLite e gera o CSV de pré-visualização do dedup.

**Files:**
- Create: `src/embed-fetcher.js`

- [ ] **Step 1: Implementar `src/embed-fetcher.js`**

Criar `src/embed-fetcher.js`:

```js
import fs from "node:fs";
import path from "node:path";
import { fetchEmbedCandidates } from "./embed-wordpress.js";
import { extractVimeoIds } from "./embed-scanner.js";
import { config } from "./config.js";
import { logger } from "./utils/logger.js";

/**
 * Escapa um valor para uma célula de CSV.
 * @param {*} v
 * @returns {string}
 */
function csvField(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Fase `scan`: percorre as matérias com vídeo embedado, monta a fila
 * em `embed_posts` e gera um CSV de pré-visualização do dedup.
 * Não altera nada em produção.
 * @param {Object} embedDb - Instância de createEmbedDb
 * @returns {Promise<Object>} Resumo da operação
 */
export async function scanAndQueue(embedDb) {
  let page = 1;
  let totalPosts = 0;
  let totalVideos = 0;
  let queuedPosts = 0;
  let reused = 0;
  let needUpload = 0;

  const csvPath = path.join("data", `embed-scan.${config.appEnv}.csv`);
  const csvLines = ["wp_post_id,title,post_url,vimeo_id,dedup"];

  logger.info("Starting embed scan");

  while (true) {
    const data = await fetchEmbedCandidates({ page });

    for (const item of data.items) {
      const ids = extractVimeoIds(item.content);
      if (ids.length === 0) continue;

      totalPosts++;
      totalVideos += ids.length;

      const inserted = embedDb.upsertEmbedPost({
        wp_post_id: item.id,
        title: item.title,
        post_url: item.post_url,
        post_date: item.post_date,
        video_count: ids.length,
      });
      if (inserted) queuedPosts++;

      for (const vid of ids) {
        const resolved = embedDb.resolveYoutubeId(vid);
        const dedup = resolved ? resolved.source : "needs_upload";
        if (resolved) reused++;
        else needUpload++;
        csvLines.push(
          [item.id, csvField(item.title), csvField(item.post_url), vid, dedup].join(",")
        );
      }
    }

    if (page >= (data.total_pages || 1)) break;
    page++;
  }

  fs.writeFileSync(csvPath, csvLines.join("\n") + "\n");

  const summary = { totalPosts, totalVideos, queuedPosts, reused, needUpload, csvPath };
  logger.info("Embed scan completed", summary);
  return summary;
}
```

- [ ] **Step 2: Verificar sintaxe**

Run: `node --check src/embed-fetcher.js`
Expected: sem saída (sintaxe OK)

- [ ] **Step 3: Rodar o lint**

Run: `npm run lint`
Expected: PASS — sem erros do eslint

- [ ] **Step 4: Commit**

```bash
git add src/embed-fetcher.js
git commit -m "feat: adiciona scanAndQueue para a fase scan da migracao de embedados"
```

---

## Task 7: Orquestração do migrate — `embed-worker.js`

Processa cada matéria: rebusca conteúdo fresco, resolve cada vídeo (dedup ou download+upload), reescreve e grava.

**Files:**
- Create: `src/embed-worker.js`

- [ ] **Step 1: Implementar `src/embed-worker.js`**

Criar `src/embed-worker.js`:

```js
import fs from "node:fs";
import { config } from "./config.js";
import { fetchEmbedCandidates, updatePostContent } from "./embed-wordpress.js";
import { extractVimeoIds } from "./embed-scanner.js";
import { rewriteContent } from "./embed-rewriter.js";
import { downloadVimeoToFile } from "./vimeo.js";
import { uploadToYouTube } from "./youtube.js";
import { logger } from "./utils/logger.js";
import { EmbedJobStatus } from "./constants.js";

/**
 * Resolve um vídeo do Vimeo para um ID do YouTube.
 * Tenta dedup; se faltar e não for dry-run, baixa e sobe.
 * @param {Object} embedDb
 * @param {string} vimeoId
 * @param {Object} post - Linha de embed_posts
 * @param {boolean} dryRun
 * @returns {Promise<{youtubeId:string, youtubeUrl:string, reused:boolean}|null>}
 */
async function resolveVideo(embedDb, vimeoId, post, dryRun) {
  const existing = embedDb.resolveYoutubeId(vimeoId);
  if (existing) {
    logger.info("Video reused (dedup)", {
      vimeoId,
      source: existing.source,
      youtubeUrl: existing.youtubeUrl,
    });
    return { youtubeId: existing.youtubeId, youtubeUrl: existing.youtubeUrl, reused: true };
  }

  if (dryRun) {
    logger.info("[dry-run] would download + upload", { vimeoId });
    return null;
  }

  const dl = await downloadVimeoToFile({ vimeoId, outDir: config.tmpDir });
  const yt = await uploadToYouTube({
    filePath: dl.outPath,
    title: dl.title || `Video ${vimeoId}`,
    description: "",
    tags: [],
    vimeoUrl: dl.vimeoUrl,
    vimeoId,
    wpPostId: post.wp_post_id,
    postUrl: post.post_url,
    createdTime: dl.createdTime,
  });

  embedDb.recordVideoMap({
    vimeo_id: vimeoId,
    youtube_id: yt.youtubeId,
    youtube_url: yt.youtubeUrl,
    vimeo_name: dl.title || null,
    source_post_id: post.wp_post_id,
  });

  if (config.worker.cleanupOk) {
    try {
      fs.unlinkSync(dl.outPath);
    } catch (e) {
      logger.warn("Cleanup failed", { filePath: dl.outPath, error: e.message });
    }
  }

  logger.info("Video uploaded", { vimeoId, youtubeUrl: yt.youtubeUrl });
  return { youtubeId: yt.youtubeId, youtubeUrl: yt.youtubeUrl, reused: false };
}

/**
 * Migra uma matéria: rebusca conteúdo fresco, resolve os vídeos,
 * reescreve e grava. Em dry-run não baixa, não sobe e não grava.
 * @param {Object} embedDb
 * @param {Object} post - Linha de embed_posts
 * @param {Object} [opts]
 * @param {boolean} [opts.dryRun=false]
 */
export async function migrateEmbedPost(embedDb, post, { dryRun = false } = {}) {
  const data = await fetchEmbedCandidates({ postId: post.wp_post_id });
  const item = data.items && data.items[0];

  if (!item) {
    if (!dryRun) {
      embedDb.setEmbedPostStatus(post.id, EmbedJobStatus.NO_VIDEOS, {
        error: "post not returned by WP",
      });
    }
    logger.warn("Post not returned by WP", { wpPostId: post.wp_post_id });
    return;
  }

  const vimeoIds = extractVimeoIds(item.content);
  if (vimeoIds.length === 0) {
    if (!dryRun) {
      embedDb.setEmbedPostStatus(post.id, EmbedJobStatus.NO_VIDEOS, { error: null });
    }
    logger.info("No Vimeo embeds in fresh content", { wpPostId: post.wp_post_id });
    return;
  }

  const videoMap = {};
  let allResolved = true;
  for (const vid of vimeoIds) {
    const r = await resolveVideo(embedDb, vid, post, dryRun);
    if (r) videoMap[vid] = r.youtubeId;
    else allResolved = false;
  }

  if (dryRun) {
    logger.info("[dry-run] post processed", {
      wpPostId: post.wp_post_id,
      videos: vimeoIds.length,
      resolvedNow: Object.keys(videoMap).length,
    });
    return;
  }

  if (!allResolved) {
    throw new Error("Not all videos resolved");
  }

  const { content: newContent, missingIds } = rewriteContent(item.content, videoMap);
  if (missingIds.length > 0) {
    throw new Error(`Rewrite left unresolved videos: ${missingIds.join(",")}`);
  }
  if (extractVimeoIds(newContent).length > 0) {
    throw new Error("Rewrite validation failed: Vimeo embeds still present");
  }

  await updatePostContent({ postId: post.wp_post_id, content: newContent });

  embedDb.setEmbedPostStatus(post.id, EmbedJobStatus.DONE, { error: null });
  logger.info("Post migrated", { wpPostId: post.wp_post_id, videos: vimeoIds.length });
}

/**
 * Loop da fase `migrate`.
 * @param {Object} embedDb
 * @param {Object} [opts]
 * @param {boolean} [opts.dryRun=false]
 * @param {number} [opts.limit=0] - 0 = sem limite
 * @returns {Promise<{processed:number}>}
 */
export async function runEmbedWorkerLoop(embedDb, { dryRun = false, limit = 0 } = {}) {
  let processed = 0;

  if (dryRun) {
    const posts = embedDb.pendingEmbedPosts();
    for (const post of posts) {
      if (limit > 0 && processed >= limit) break;
      logger.info("[dry-run] Starting embed post", {
        id: post.id,
        wpPostId: post.wp_post_id,
      });
      try {
        await migrateEmbedPost(embedDb, post, { dryRun: true });
      } catch (err) {
        logger.error("[dry-run] would fail", {
          id: post.id,
          error: err?.message || String(err),
        });
      }
      processed++;
    }
    logger.info("[dry-run] finished", { processed });
    return { processed };
  }

  while (true) {
    if (limit > 0 && processed >= limit) {
      logger.info("Reached limit", { limit });
      break;
    }
    const post = embedDb.nextEmbedPost();
    if (!post) {
      logger.info("No more embed posts to process");
      break;
    }

    embedDb.incEmbedPostAttempts(post.id);
    embedDb.setEmbedPostStatus(post.id, EmbedJobStatus.PROCESSING);
    logger.info("Starting embed post", {
      id: post.id,
      wpPostId: post.wp_post_id,
      attempt: post.attempts + 1,
    });

    try {
      await migrateEmbedPost(embedDb, post, { dryRun: false });
    } catch (err) {
      const msg = err?.response?.data
        ? JSON.stringify(err.response.data)
        : err?.message || String(err);
      embedDb.setEmbedPostStatus(post.id, EmbedJobStatus.FAILED, { error: msg });
      logger.error("Embed post failed", { id: post.id, error: msg });
    }
    processed++;
  }

  logger.info("Embed worker loop finished", { processed });
  return { processed };
}
```

- [ ] **Step 2: Verificar sintaxe**

Run: `node --check src/embed-worker.js`
Expected: sem saída (sintaxe OK)

- [ ] **Step 3: Rodar o lint**

Run: `npm run lint`
Expected: PASS — sem erros do eslint

- [ ] **Step 4: Commit**

```bash
git add src/embed-worker.js
git commit -m "feat: adiciona embed-worker com migrate, dedup e dry-run"
```

---

## Task 8: Entrypoint CLI e scripts npm

**Files:**
- Create: `src/embed-cli.js`
- Modify: `package.json`

- [ ] **Step 1: Implementar `src/embed-cli.js`**

Criar `src/embed-cli.js`:

```js
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
```

- [ ] **Step 2: Adicionar os scripts npm**

Em `package.json`, no objeto `scripts`, logo após a linha `"status:prod": ...`, adicionar as 3 linhas novas. O trecho deve ficar:

```json
    "status:prod": "NODE_ENV=prod node src/cli.js status",
    "embed:scan:prod": "NODE_ENV=prod node src/embed-cli.js scan",
    "embed:migrate:prod": "NODE_ENV=prod node src/embed-cli.js migrate",
    "embed:status:prod": "NODE_ENV=prod node src/embed-cli.js status",
    "lint": "eslint src/",
```

- [ ] **Step 3: Verificar sintaxe e lint**

Run: `node --check src/embed-cli.js && npm run lint`
Expected: sem saída do `--check`; lint PASS

- [ ] **Step 4: Verificar que o CLI mostra o usage sem argumentos**

Run: `NODE_ENV=prod node src/embed-cli.js`
Expected: imprime `Usage: node src/embed-cli.js <scan|migrate|status> [--dry-run] [--limit=N]` e sai com código 1

- [ ] **Step 5: Verificar que `status` roda contra o banco real**

Run: `npm run embed:status:prod`
Expected: imprime `ENV=prod DB=./data/jobs.prod.sqlite` e um objeto (provavelmente `{}` — sem matérias ainda)

- [ ] **Step 6: Commit**

```bash
git add src/embed-cli.js package.json
git commit -m "feat: adiciona CLI embed-cli e scripts npm da migracao de embedados"
```

---

## Task 9: Plugin WordPress v2.2.0 — endpoints novos

Adiciona os endpoints `embed-candidates` (GET) e `update-content` (POST) ao plugin existente.

**Files:**
- Modify: `plugin-vimeo2yt-migrate.php`

- [ ] **Step 1: Subir a versão do plugin para 2.2.0**

Em `plugin-vimeo2yt-migrate.php`, no cabeçalho do plugin, trocar a linha da versão:

De:
```php
 * Version: 2.1.0
```
Para:
```php
 * Version: 2.2.0
```

- [ ] **Step 2: Registrar as 2 rotas novas**

Em `plugin-vimeo2yt-migrate.php`, localizar o fim do bloco `add_action('rest_api_init', ...)`. O trecho atual termina assim:

```php
      'meta_key' => ['type' => 'string', 'required' => false],
    ],
  ]);

});
```

Substituir esse trecho por:

```php
      'meta_key' => ['type' => 'string', 'required' => false],
    ],
  ]);

  // 3) LISTAR MATÉRIAS COM VÍDEO EMBEDADO NO CONTEÚDO
  register_rest_route('migrate/v1', '/embed-candidates', [
    'methods' => 'GET',
    'callback' => 'vimeo2yt_get_embed_candidates',
    'permission_callback' => 'vimeo2yt_token_ok',
    'args' => [
      'per_page' => ['type' => 'integer', 'default' => 20],
      'page' => ['type' => 'integer', 'default' => 1],
      'post_id' => ['type' => 'integer', 'default' => 0],
    ],
  ]);

  // 4) ATUALIZAR O CONTEÚDO (post_content) DA MATÉRIA
  register_rest_route('migrate/v1', '/update-content', [
    'methods' => 'POST',
    'callback' => 'vimeo2yt_update_content',
    'permission_callback' => 'vimeo2yt_token_ok',
    'args' => [
      'post_id' => ['type' => 'integer', 'required' => true],
      'content' => ['type' => 'string', 'required' => true],
    ],
  ]);

});
```

- [ ] **Step 3: Adicionar as funções de callback no fim do arquivo**

Em `plugin-vimeo2yt-migrate.php`, localizar o fim da função `vimeo2yt_update_youtube` — o arquivo termina assim:

```php
  return new WP_REST_Response([
    'ok' => true,
    'post_id' => $post_id,
    'youtube_url' => $youtube_url,
    'meta_key' => $meta_key
  ], 200);
}
```

Substituir esse trecho por (mesmo conteúdo + as 3 funções novas):

```php
  return new WP_REST_Response([
    'ok' => true,
    'post_id' => $post_id,
    'youtube_url' => $youtube_url,
    'meta_key' => $meta_key
  ], 200);
}

/**
 * Monta o item de resposta para uma matéria com vídeo embedado.
 */
function vimeo2yt_embed_item($post)
{
  return [
    'id' => (int) $post->ID,
    'title' => (string) $post->post_title,
    'post_url' => (string) get_permalink($post->ID),
    'post_date' => (string) $post->post_date,
    'content' => (string) $post->post_content,
  ];
}

/**
 * GET /wp-json/migrate/v1/embed-candidates?per_page=20&page=1
 * GET /wp-json/migrate/v1/embed-candidates?post_id=123
 *
 * Lista matérias publicadas cujo post_content contém um iframe do player
 * do Vimeo. Com post_id, devolve só aquela matéria (conteúdo fresco).
 */
function vimeo2yt_get_embed_candidates(WP_REST_Request $req)
{
  global $wpdb;

  $post_id = (int) $req->get_param('post_id');
  if ($post_id > 0) {
    $post = get_post($post_id);
    $items = ($post && $post->post_status !== 'trash') ? [vimeo2yt_embed_item($post)] : [];
    return new WP_REST_Response([
      'page' => 1,
      'per_page' => 1,
      'total' => count($items),
      'total_pages' => count($items) > 0 ? 1 : 0,
      'items' => $items,
    ], 200);
  }

  $per_page = max(1, min(100, (int) $req->get_param('per_page')));
  $page = max(1, (int) $req->get_param('page'));
  $offset = ($page - 1) * $per_page;
  $like = '%player.vimeo.com/video/%';

  $total = (int) $wpdb->get_var(
    $wpdb->prepare(
      "SELECT COUNT(*) FROM {$wpdb->posts} WHERE post_status = 'publish' AND post_content LIKE %s",
      $like
    )
  );

  $ids = $wpdb->get_col(
    $wpdb->prepare(
      "SELECT ID FROM {$wpdb->posts}
       WHERE post_status = 'publish' AND post_content LIKE %s
       ORDER BY post_date ASC
       LIMIT %d OFFSET %d",
      $like,
      $per_page,
      $offset
    )
  );

  $items = [];
  foreach ($ids as $id) {
    $post = get_post((int) $id);
    if ($post) {
      $items[] = vimeo2yt_embed_item($post);
    }
  }

  return new WP_REST_Response([
    'page' => $page,
    'per_page' => $per_page,
    'total' => $total,
    'total_pages' => (int) ceil($total / $per_page),
    'items' => $items,
  ], 200);
}

/**
 * POST /wp-json/migrate/v1/update-content
 * Body JSON: { "post_id": 123, "content": "<novo post_content>" }
 *
 * Grava o post_content driblando o kses (que estriparia o <iframe>).
 */
function vimeo2yt_update_content(WP_REST_Request $req)
{
  $post_id = (int) $req->get_param('post_id');
  $content = (string) $req->get_param('content');

  if (!$post_id || $content === '') {
    return new WP_REST_Response(['ok' => false, 'error' => 'missing_params'], 400);
  }

  $post = get_post($post_id);
  if (!$post) {
    return new WP_REST_Response(['ok' => false, 'error' => 'post_not_found'], 404);
  }

  // Remove os filtros do kses para preservar o <iframe> do YouTube,
  // e reativa logo após gravar.
  kses_remove_filters();
  $result = wp_update_post([
    'ID' => $post_id,
    'post_content' => $content,
  ], true);
  kses_init_filters();

  if (is_wp_error($result)) {
    return new WP_REST_Response(['ok' => false, 'error' => $result->get_error_message()], 500);
  }

  return new WP_REST_Response(['ok' => true, 'post_id' => $post_id], 200);
}
```

- [ ] **Step 4: Verificar a sintaxe PHP**

Run: `php -l plugin-vimeo2yt-migrate.php`
Expected: `No syntax errors detected in plugin-vimeo2yt-migrate.php`
(Se o PHP CLI não estiver instalado, pular este step — a sintaxe será validada no deploy da Task 10.)

- [ ] **Step 5: Commit**

```bash
git add plugin-vimeo2yt-migrate.php
git commit -m "feat: plugin v2.2.0 com endpoints embed-candidates e update-content"
```

---

## Task 10: Validação end-to-end (manual — handoff)

Esta task **não tem código** — é a sequência de validação em produção, executada pelo usuário. O agente deve **parar aqui** e entregar estas instruções.

- [ ] **Step 1: Deploy do plugin WordPress v2.2.0**

Subir o `plugin-vimeo2yt-migrate.php` atualizado para o WordPress de produção (mesmo método usado nas versões anteriores) e confirmar que o plugin continua ativo.

- [ ] **Step 2: Smoke test dos endpoints novos**

```bash
# embed-candidates — deve retornar HTTP 200 e uma lista de matérias.
# Trocar <WP_BASE_URL> e <WP_MIGRATE_TOKEN> pelos valores do .env.prod.
curl -s -w "\nHTTP %{http_code}\n" \
  -H "X-Migrate-Token: <WP_MIGRATE_TOKEN>" \
  "<WP_BASE_URL>/wp-json/migrate/v1/embed-candidates?per_page=2&page=1"
```
Expected: HTTP 200 e JSON com `items` contendo matérias com `content`.

- [ ] **Step 2b: Rodar a suíte de testes completa**

Run: `npm test`
Expected: PASS — todos os testes de `tests/` passam.

- [ ] **Step 3: Fase scan**

Run: `npm run embed:scan:prod`
Expected: imprime o resumo (`totalPosts`, `totalVideos`, `queuedPosts`, `reused`, `needUpload`). Revisar o CSV gerado em `data/embed-scan.prod.csv`.

- [ ] **Step 4: Dry-run da migração**

Run: `NODE_ENV=prod node src/embed-cli.js migrate --dry-run`
Expected: loga, por matéria, quais vídeos seriam reusados e quais subiriam — sem baixar, subir ou gravar.

- [ ] **Step 5: Primeira migração real — 1 matéria**

Run: `NODE_ENV=prod node src/embed-cli.js migrate --limit=1`
Expected: processa uma matéria; sobe o(s) vídeo(s) que faltam; grava o conteúdo novo.

- [ ] **Step 6: Conferir no site**

Abrir a matéria migrada no WordPress e confirmar: o player do YouTube aparece, o layout (wrapper responsivo) está preservado, e não sobrou nada do Vimeo.

- [ ] **Step 7: Soltar o restante**

Se o passo 6 estiver OK: `npm run embed:migrate:prod`. Acompanhar o `npm run embed:status:prod` e o log.

---

## Self-Review

**1. Cobertura do spec:**

- Dedup "reusar de tudo que já existe" → `resolveYoutubeId` (Task 4) consulta `video_map` + `jobs`; usado no scan (Task 6) e no worker (Task 7). ✓
- Substituição "trocar só o iframe, manter o wrapper" → `rewriteContent` (Task 3). ✓
- Duas fases `scan`/`migrate` com `--dry-run` e `--limit=N` → Tasks 6, 7, 8. ✓
- Título = nome do Vimeo → `resolveVideo` passa `title: dl.title` (Task 7); `dl.title` vem de `getVimeoDownloadUrl` que usa `v.name`. ✓
- Regex `PLAYER_VIMEO_ID` → Task 1. ✓
- Endpoints `embed-candidates` + `update-content`, kses → Task 9. ✓
- Modelo de dados `embed_posts` + `video_map` → Task 4. ✓
- Rebusca de conteúdo fresco → `migrateEmbedPost` chama `fetchEmbedCandidates({postId})` (Task 7). ✓
- Validação pós-rewrite → `migrateEmbedPost` checa `missingIds` e `extractVimeoIds(newContent)` (Task 7). ✓
- Segurança "matéria só é gravada se todos os vídeos resolverem" → `allResolved` (Task 7). ✓
- Idempotência → coberta por teste em Task 3. ✓
- Status `no_videos` → setado em `migrateEmbedPost` quando o conteúdo fresco não tem mais iframe. ✓
- Testes: rewriter, parser, dedup → Tasks 2, 3, 4. ✓
- Throttling por `--limit=N`, sem tabela de quota → Task 7/8. ✓
- Privacidade `unlisted` → `uploadToYouTube` usa `config.yt.privacyStatus` (`unlisted` no `.env.prod`), reusado sem alteração. ✓

**2. Placeholders:** nenhum "TBD"/"TODO"/"etc." — todo step tem código ou comando completo.

**3. Consistência de tipos:** `createEmbedDb` expõe `upsertEmbedPost`, `nextEmbedPost`, `pendingEmbedPosts`, `setEmbedPostStatus`, `incEmbedPostAttempts`, `embedStats`, `resolveYoutubeId`, `recordVideoMap`, `close`, `db` — todos os nomes usados em `embed-fetcher.js`, `embed-worker.js` e `embed-cli.js` batem. `rewriteContent` devolve `{content, replacedIds, missingIds}` — consumido corretamente no worker. `fetchEmbedCandidates`/`updatePostContent` — assinaturas batem entre `embed-wordpress.js` e os consumidores.
