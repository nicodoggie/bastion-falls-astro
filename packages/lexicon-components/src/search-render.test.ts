import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  renderLexiconSearchResult,
  renderLexiconSearchSuggestions,
  renderLexiconTagSuggestions,
} from "./search-render.ts";
import type { LexiconSearchIndex, LexiconSearchResult } from "./types.ts";

const result: LexiconSearchResult = {
  score: 0,
  matchedFields: [],
  entry: {
    id: "ehk:-asam",
    writtenForm: "-asam",
    phoneticForm: "a.səm",
    types: ["ontolex:LexicalEntry", "lexinfo:Suffix"],
    typeLabels: ["suffix"],
    senses: [{ definition: "downward" }],
    alphaPage: 1,
    fieldUris: [],
    fieldLabels: [],
  },
};

describe("renderLexiconSearchResult", () => {
  it("uses an explicit button disclosure instead of native details markers", () => {
    const html = renderLexiconSearchResult("/lexicon", result);

    assert.equal(html.includes("<details"), false);
    assert.equal(html.includes("<summary"), false);
    assert.match(html, /class="lex-search-row"/);
    assert.match(html, /aria-expanded="false"/);
    assert.match(html, /class="lex-search-disclosure"/);
  });

  it("renders audio sources when an entry has playable media", () => {
    const html = renderLexiconSearchResult("/lexicon", {
      ...result,
      entry: {
        ...result.entry,
        audio: {
          label: "Pronunciation",
          sources: [
            {
              url: "/audio/foo.webm",
              type: "audio/webm; codecs=opus",
            },
            {
              url: "/audio/foo.mp3",
              type: "audio/mpeg",
            },
          ],
        },
      },
    });

    assert.match(html, /class="lex-search-pronunciation"/);
    assert.match(html, /<button class="lex-search-audio-button" type="button"/);
    assert.match(html, /aria-label="Play pronunciation for -asam"/);
    assert.match(html, /<svg class="lex-search-audio-icon"/);
    assert.match(html, /<audio class="lex-search-audio"[^>]*preload="metadata"/);
    assert.doesNotMatch(html, /<audio class="lex-search-audio" controls/);
    assert.match(html, /src="\/audio\/foo\.webm"/);
    assert.match(html, /type="audio\/webm; codecs=opus"/);
    assert.match(html, /src="\/audio\/foo\.mp3"/);
    assert.ok(html.indexOf("lex-search-phonetic") < html.indexOf("lex-search-audio-button"));
    assert.ok(html.indexOf("lex-search-audio-button") < html.indexOf("lex-search-type"));
  });
});

describe("renderLexiconTagSuggestions", () => {
  it("renders prefixed suggestions after supported filter prefixes", () => {
    const index: LexiconSearchIndex = {
      version: 1,
      localeId: "test",
      title: "Test",
      entries: [
        {
          ...result.entry,
          fieldLabels: ["sacred terms", "Motion"],
        },
      ],
    };

    assert.equal(renderLexiconTagSuggestions(index, "ta"), "");

    const html = renderLexiconTagSuggestions(index, "tag:");

    assert.match(html, /role="listbox"/);
    assert.match(html, /data-lex-suggestion="tag:Motion"/);
    assert.match(html, />tag:Motion</);
    assert.match(html, /data-lex-suggestion="tag:sacred terms"/);
    assert.match(html, />tag:sacred terms</);

    const typeHtml = renderLexiconSearchSuggestions(index, "type:");

    assert.match(typeHtml, /aria-label="Search suggestions"/);
    assert.match(typeHtml, /data-lex-suggestion="type:suffix"/);
    assert.match(typeHtml, />type:suffix</);
  });
});
