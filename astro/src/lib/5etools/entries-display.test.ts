import assert from "node:assert/strict";
import { test } from "node:test";

import { entriesToDisplayParagraphs } from "./entries-display.ts";

test("renders safe formatting tags while leaving data tags as plain text", () => {
  const paragraphs = entriesToDisplayParagraphs([
    "{@i whispered} about {@creature Kotryna|BF} and {@damage 2d6}.",
  ]);

  assert.deepEqual(paragraphs, [
    "<em>whispered</em> about Kotryna and 2d6.",
  ]);
});

test("drops unsafe html from tag text and removes tag props", () => {
  const paragraphs = entriesToDisplayParagraphs([
    "{@b <img src=x onerror=alert(1)>bold|ignored} {@spell fireball|phb}",
  ]);

  assert.deepEqual(paragraphs, ["<strong>bold</strong> fireball"]);
});
