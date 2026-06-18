import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { LexiconSearchEntry, LexiconSearchIndex } from "./types.ts";
import {
  listLexiconEntries,
  listLexiconQuerySuggestions,
  listLexiconTagQuerySuggestions,
  listLexiconTagSuggestions,
  listLexiconTypeSuggestions,
  listLexiconTypeBadges,
  moveLexiconSuggestionIndex,
  paginateLexiconResults,
  searchLexicon,
  summarizeLexiconSenses,
} from "./search.ts";

const index: LexiconSearchIndex = {
  version: 1,
  localeId: "test",
  title: "Test Lexicon",
  entries: [
    {
      id: "ehk:thral",
      writtenForm: "thral",
      phoneticForm: "thral",
      types: ["ontolex:LexicalEntry", "lexinfo:Noun"],
      typeLabels: ["noun"],
      senses: [
        {
          definition: "divine revelation",
          usage: "ritual speech",
          semanticField: ["sacred terms"],
        },
      ],
      alphaPage: 1,
      fieldUris: ["sacred-terms"],
      fieldLabels: ["sacred terms"],
    },
    {
      id: "ehk:barak'er",
      writtenForm: "barak'er",
      phoneticForm: "barakʔer",
      types: ["ontolex:LexicalEntry", "lexinfo:Verb"],
      typeLabels: ["verb"],
      senses: [{ definition: "to walk" }],
      alphaPage: 2,
      fieldUris: ["motion"],
      fieldLabels: ["motion"],
    },
  ],
};

describe("searchLexicon", () => {
  it("lists dictionary entries alphabetically when browsing without a query", () => {
    assert.deepEqual(
      listLexiconEntries(index).map((result) => result.entry.id),
      ["ehk:barak'er", "ehk:thral"],
    );
  });

  it("paginates dictionary results with stable page metadata", () => {
    const results = listLexiconEntries(index);
    const page = paginateLexiconResults(results, { page: 2, pageSize: 1 });

    assert.equal(page.page, 2);
    assert.equal(page.pageCount, 2);
    assert.equal(page.total, 2);
    assert.deepEqual(
      page.items.map((result) => result.entry.id),
      ["ehk:thral"],
    );
  });

  it("summarizes only the first two senses for collapsed rows", () => {
    const entry: LexiconSearchEntry = {
      ...index.entries[0],
      senses: [
        { definition: "first sense" },
        { definition: "second sense" },
        { definition: "third sense" },
      ],
    };

    assert.deepEqual(summarizeLexiconSenses(entry), [
      "first sense",
      "second sense",
    ]);
  });

  it("uses normalized lexical type labels as badge text", () => {
    assert.deepEqual(listLexiconTypeBadges(index.entries[0]), ["noun"]);
  });

  it("ranks direct word matches before definition and tag matches", () => {
    const results = searchLexicon(index, "thral");

    assert.equal(results[0]?.entry.id, "ehk:thral");
    assert.ok(results[0]?.matchedFields.includes("word"));
  });

  it("supports definition and tag prefixes", () => {
    assert.equal(searchLexicon(index, "def:revelation")[0]?.entry.id, "ehk:thral");
    assert.equal(searchLexicon(index, "tag:sacred")[0]?.entry.id, "ehk:thral");
  });

  it("lists unique semantic-field labels for tag autocomplete", () => {
    const suggestions = listLexiconTagSuggestions({
      ...index,
      entries: [
        ...index.entries,
        {
          ...index.entries[0],
          id: "ehk:ritual",
          writtenForm: "ritual",
          fieldLabels: ["Ritual practice", "sacred terms", ""],
        },
      ],
    });

    assert.deepEqual(suggestions, ["motion", "Ritual practice", "sacred terms"]);
  });

  it("only suggests semantic-field tags after an explicit tag prefix", () => {
    assert.deepEqual(listLexiconTagQuerySuggestions(index, "ta"), []);
    assert.deepEqual(listLexiconTagQuerySuggestions(index, "tag:"), [
      "tag:motion",
      "tag:sacred terms",
    ]);
    assert.deepEqual(listLexiconTagQuerySuggestions(index, "tag:sa"), [
      "tag:sacred terms",
    ]);
  });

  it("suggests lexical categories after type and pos prefixes", () => {
    assert.deepEqual(listLexiconTypeSuggestions(index), ["noun", "verb"]);
    assert.deepEqual(listLexiconQuerySuggestions(index, "ty"), []);
    assert.deepEqual(listLexiconQuerySuggestions(index, "type:"), [
      "type:noun",
      "type:verb",
    ]);
    assert.deepEqual(listLexiconQuerySuggestions(index, "type:no"), ["type:noun"]);
    assert.deepEqual(listLexiconQuerySuggestions(index, "pos:v"), ["pos:verb"]);
  });

  it("wraps suggestion keyboard navigation in both directions", () => {
    assert.equal(moveLexiconSuggestionIndex(-1, 3, 1), 0);
    assert.equal(moveLexiconSuggestionIndex(2, 3, 1), 0);
    assert.equal(moveLexiconSuggestionIndex(-1, 3, -1), 2);
    assert.equal(moveLexiconSuggestionIndex(0, 3, -1), 2);
    assert.equal(moveLexiconSuggestionIndex(0, 0, 1), -1);
  });

  it("supports type prefix and pos alias with normalized lexical categories", () => {
    assert.deepEqual(
      searchLexicon(index, "type:noun").map((result) => result.entry.id),
      ["ehk:thral"],
    );
    assert.deepEqual(
      searchLexicon(index, "pos:verb").map((result) => result.entry.id),
      ["ehk:barak'er"],
    );
  });

  it("matches all terms in a multi-token smart query", () => {
    assert.equal(
      searchLexicon(index, "sacred revelation")[0]?.entry.id,
      "ehk:thral",
    );
  });

  it("returns no results for empty or unmatched queries", () => {
    assert.deepEqual(searchLexicon(index, ""), []);
    assert.deepEqual(searchLexicon(index, "def:stone"), []);
  });
});
