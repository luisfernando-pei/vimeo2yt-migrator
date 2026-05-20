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
