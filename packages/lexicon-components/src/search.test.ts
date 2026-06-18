import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { LexiconSearchEntry, LexiconSearchIndex } from "./types.ts";
import {
  listLexiconEntries,
  listLexiconTypeBadges,
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
