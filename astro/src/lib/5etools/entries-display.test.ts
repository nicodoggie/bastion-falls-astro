import assert from "node:assert/strict";
import { test } from "node:test";

import { entriesToDisplayParagraphs } from "./entries-display.ts";

test("renders safe formatting and reference tags", () => {
  const paragraphs = entriesToDisplayParagraphs([
    "{@i whispered} about {@creature Ancient Red Dragon} and {@damage 2d6}.",
  ]);

  assert.equal(paragraphs.length, 1);
  const [paragraph = ""] = paragraphs;
  assert.match(paragraph, /^<em>whispered<\/em> about /);
  assert.match(paragraph, /class="bf5e-ref bf5e-ref--inline bf5e-ref--creature"/);
  assert.match(paragraph, />Ancient Red Dragon<\/span>/);
  assert.match(paragraph, /class="bf5e-tip__heading">Ancient Red Dragon<\/span>/);
  assert.match(paragraph, /and <strong class="bf5e-mechanic"><em>2d6<\/em><\/strong>\./);
});

test("drops unsafe html from tag text and removes tag props", () => {
  const paragraphs = entriesToDisplayParagraphs([
    "{@b <img src=x onerror=alert(1)>bold|ignored} {@spell fireball|phb}",
  ]);

  assert.equal(paragraphs.length, 1);
  const [paragraph = ""] = paragraphs;
  assert.match(paragraph, /^<strong>bold<\/strong> /);
  assert.match(paragraph, /class="bf5e-ref-wrap"/);
  assert.match(paragraph, /class="bf5e-ref bf5e-ref--inline bf5e-ref--spell"/);
  assert.match(paragraph, />fireball<\/span>/);
  assert.match(paragraph, /class="bf5e-tip__heading">Fireball<\/span>/);
  assert.doesNotMatch(paragraph, /onerror|<img/);
});

test("uses display text for entity tags and emphasizes mechanics tags", () => {
  const paragraphs = entriesToDisplayParagraphs([
    "{@spell Fireball|XPHB|flame blossom} calls for {@dc 15}, {@hit +7}, {@recharge 5}, and {@chance 25}. It grants {@sense Darkvision|XPHB|night sight}.",
  ]);

  assert.equal(paragraphs.length, 1);
  const [paragraph = ""] = paragraphs;
  assert.match(paragraph, /class="bf5e-ref-wrap"/);
  assert.match(paragraph, />flame blossom<\/span>/);
  assert.match(paragraph, /class="bf5e-tip__heading">Fireball<\/span>/);
  assert.match(paragraph, /calls for <strong class="bf5e-mechanic"><em>DC 15<\/em><\/strong>/);
  assert.match(paragraph, /<strong class="bf5e-mechanic"><em>\+7<\/em><\/strong>/);
  assert.match(paragraph, /<strong class="bf5e-mechanic"><em>\(Recharge 5-6\)<\/em><\/strong>/);
  assert.match(paragraph, /<strong class="bf5e-mechanic"><em>25 percent<\/em><\/strong>/);
  assert.match(paragraph, /class="bf5e-ref bf5e-ref--inline bf5e-ref--sense"/);
  assert.match(paragraph, />night sight<\/span>/);
  assert.match(paragraph, /class="bf5e-tip__heading">Darkvision<\/span>/);
});

test("renders tooltips for item condition and feat references", () => {
  const paragraphs = entriesToDisplayParagraphs([
    "{@item Longsword} against a {@condition Poisoned} target rewards {@feat Alert|XPHB}.",
  ]);

  assert.equal(paragraphs.length, 1);
  const [paragraph = ""] = paragraphs;
  assert.match(paragraph, /class="bf5e-ref bf5e-ref--inline bf5e-ref--item"/);
  assert.match(paragraph, /class="bf5e-tip__heading">Longsword<\/span>/);
  assert.match(paragraph, /class="bf5e-ref bf5e-ref--inline bf5e-ref--condition"/);
  assert.match(paragraph, /class="bf5e-tip__heading">Poisoned<\/span>/);
  assert.match(paragraph, /class="bf5e-ref bf5e-ref--inline bf5e-ref--feat"/);
  assert.match(paragraph, /class="bf5e-tip__heading">Alert<\/span>/);
});
