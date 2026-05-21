import test from "node:test";
import assert from "node:assert";
import { classifyEmbedError } from "../src/embed-errors.js";
import { EmbedJobStatus, ErrorMessages } from "../src/constants.js";

test("classifyEmbedError: erro de sem-links-de-download vira skipped_external", () => {
  const err = new Error(ErrorMessages.VIMEO_NO_DOWNLOAD_LINKS);
  assert.strictEqual(classifyEmbedError(err), EmbedJobStatus.SKIPPED_EXTERNAL);
});

test("classifyEmbedError: erro generico vira failed", () => {
  assert.strictEqual(classifyEmbedError(new Error("network timeout")), EmbedJobStatus.FAILED);
});

test("classifyEmbedError: erro null/undefined vira failed", () => {
  assert.strictEqual(classifyEmbedError(null), EmbedJobStatus.FAILED);
  assert.strictEqual(classifyEmbedError(undefined), EmbedJobStatus.FAILED);
});

test("classifyEmbedError: erro sem message vira failed", () => {
  assert.strictEqual(classifyEmbedError({}), EmbedJobStatus.FAILED);
});
