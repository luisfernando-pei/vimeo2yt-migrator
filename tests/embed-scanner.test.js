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
  assert.deepStrictEqual(extractVimeoIds(undefined), []);
  assert.deepStrictEqual(extractVimeoIds(""), []);
});

test("extractVimeoIds preserva a ordem de aparicao (nao ordena)", () => {
  const content = EX1.replace("1110143545", "9999999999") + "\n" + EX1;
  assert.deepStrictEqual(extractVimeoIds(content), ["9999999999", "1110143545"]);
});
