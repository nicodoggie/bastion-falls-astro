import assert from "node:assert/strict";
import { test } from "node:test";

import { entriesToDisplayParagraphs } from "./entries-display.ts";

test("renders safe formatting and reference tags", () => {
  const paragraphs = entriesToDisplayParagraphs([
    "{@i whispered} about {@creature Kotryna|BF} and {@damage 2d6}.",
  ]);

  assert.deepEqual(paragraphs, [
    '<em>whispered</em> about <span class="bf5e-ref bf5e-ref--inline bf5e-ref--creature">Kotryna</span> and <strong class="bf5e-mechanic"><em>2d6</em></strong>.',
  ]);
});

test("drops unsafe html from tag text and removes tag props", () => {
  const paragraphs = entriesToDisplayParagraphs([
    "{@b <img src=x onerror=alert(1)>bold|ignored} {@spell fireball|phb}",
  ]);

  assert.deepEqual(paragraphs, [
    '<strong>bold</strong> <span class="bf5e-ref bf5e-ref--inline bf5e-ref--spell">fireball</span>',
  ]);
});

test("uses display text for entity tags and emphasizes mechanics tags", () => {
  const paragraphs = entriesToDisplayParagraphs([
    "{@spell Fireball|XPHB|flame blossom} calls for {@dc 15}, {@hit +7}, {@recharge 5}, and {@chance 25}. It grants {@sense Darkvision|XPHB|night sight}.",
  ]);

  assert.deepEqual(paragraphs, [
    '<span class="bf5e-ref bf5e-ref--inline bf5e-ref--spell">flame blossom</span> calls for <strong class="bf5e-mechanic"><em>DC 15</em></strong>, <strong class="bf5e-mechanic"><em>+7</em></strong>, <strong class="bf5e-mechanic"><em>(Recharge 5-6)</em></strong>, and <strong class="bf5e-mechanic"><em>25 percent</em></strong>. It grants <span class="bf5e-ref bf5e-ref--inline bf5e-ref--sense">night sight</span>.',
  ]);
});
