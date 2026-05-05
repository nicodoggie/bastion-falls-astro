import { describe, expect, it } from "vitest";

import {
  compileLexiconShard,
  DuplicateLexicalIdError,
  graphObjectToLexItem,
} from "../src/compile.js";

describe("compileLexiconShard", () => {
  it("maps a minimal lexical entry", () => {
    const doc = {
      "@graph": [
        {
          "@id": "ehk:test",
          "@type": ["ontolex:LexicalEntry", "lexinfo:Noun"],
          canonicalForm: {
            "@type": "ontolex:Form",
            writtenRep: "test",
            phoneticRep: "test",
          },
          sense: [
            {
              "@type": "ontolex:LexicalSense",
              definition: { "@value": "example", "@language": "en" },
              "lexinfo:semanticField": "Basic Terms",
            },
          ],
        },
      ],
    };

    const items = compileLexiconShard("/fake/a.jsonld", doc);
    expect(items).toHaveLength(1);
    expect(items[0]?.writtenForm).toBe("test");
    expect(items[0]?.senses[0]?.definition).toBe("example");
    expect(items[0]?.senses[0]?.semanticField).toEqual(["Basic Terms"]);
  });

  it("throws DuplicateLexicalIdError per file", () => {
    const doc = {
      "@graph": [
        {
          "@id": "ehk:dup",
          "@type": ["ontolex:LexicalEntry", "lexinfo:Noun"],
          canonicalForm: { writtenRep: "a", phoneticRep: "a" },
          sense: [
            {
              definition: { "@value": "one", "@language": "en" },
            },
          ],
        },
        {
          "@id": "ehk:dup",
          "@type": ["ontolex:LexicalEntry", "lexinfo:Noun"],
          canonicalForm: { writtenRep: "b", phoneticRep: "b" },
          sense: [
            {
              definition: { "@value": "two", "@language": "en" },
            },
          ],
        },
      ],
    };

    expect(() => compileLexiconShard("/fake/dup.jsonld", doc)).toThrow(
      DuplicateLexicalIdError,
    );
  });
});

describe("graphObjectToLexItem", () => {
  it("returns null for non-entry nodes", () => {
    expect(graphObjectToLexItem({ "@id": "x", "@type": "skos:Concept" })).toBeNull();
  });
});
