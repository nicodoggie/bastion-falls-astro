# @bastion-falls/lexicon-components

Reusable language UI components for Bastion Falls conlang documentation.

The package currently ships Astro authoring components plus plain TypeScript
helpers. The interactive pieces are implemented as framework-neutral custom
elements under the hood, so the package can grow toward non-Astro wrappers
without rewriting the core behavior.

## Components

### LexiconSearchWorkbench

`LexiconSearchWorkbench` is the primary dictionary interface. It renders a
static JSON search index as a browsable, paginated lexicon. With no query, it
lists entries alphabetically; with a query, it filters the same list.

```mdx
---
import LexiconSearchWorkbench from "@bastion-falls/lexicon-components/LexiconSearchWorkbench.astro";
import searchIndex from "@/generated/lexicon/early-hick/search-index.json";
---

<LexiconSearchWorkbench
  searchIndex={searchIndex}
  lexiconUrl="/world/languages/hickic/seneran/early-hick/lexicon"
/>
```

Props:

| Prop | Type | Required | Description |
| --- | --- | --- | --- |
| `searchIndex` | `LexiconSearchIndex` | Yes | Generated static index for one language. |
| `lexiconUrl` | `string` | Yes | Public URL of the lexicon page. Used for query strings and entry permalinks. |
| `initialQuery` | `string` | No | Initial search text when the page loads. |
| `resultLimit` | `number` | No | Results per page. Defaults to `50`. |

Search syntax:

| Query | Meaning |
| --- | --- |
| `thral` | Smart search across words, IPA, definitions, usage, semantic fields, and lexical type. |
| `word:thral` | Search written forms only. |
| `def:revelation` | Search sense definitions only. |
| `tag:sacred` | Search semantic field labels and IDs. |
| `type:noun` | Search normalized lexical type labels. |
| `pos:noun` | Alias for `type:noun`. |

When the input starts with `tag:`, `type:`, or `pos:`, the workbench shows
keyboard-navigable suggestions from the current index. Entry rows include type
badges, up to two preview senses, optional audio playback beside the IPA
transcription, expandable details, and a link icon for copying a permalink.

Permalinks use the same page:

```text
/world/languages/hickic/seneran/early-hick/lexicon/?q=type%3Anoun
/world/languages/hickic/seneran/early-hick/lexicon/?entry=early-hick-thral
```

The `entry` query opens the matching entry and fills the search input with a
word search for that entry.

### InterlinearGloss

`InterlinearGloss` formats source text, gloss text, and a natural translation.
Hovering, focusing, or clicking a source token highlights the matching gloss
token, and vice versa.

Glosses should follow the project glossing style used in the Early Hick
reference grammar:

- Use lowercase lexical glosses for roots and content words: `walk`, `person`,
  `reed.boat`.
- Use uppercase abbreviations for grammatical categories: `ABS`, `ERG`, `NEG`,
  `PL`.
- Use periods to stack categories on one morpheme: `MED.DIR.ANIM`,
  `person.PROX.ABS`.
- Use hyphens for morpheme boundaries in shorthand gloss lines:
  `walk-VRB-ABS`.
- Prefer `VRB` for the Early Hick verbalizer / verbal predicate marker _-'er_
  in technical/reference examples. Beginner lessons may use plain-English
  learner labels when that is the clearer teaching choice.

Use shorthand props for simple examples where source and gloss tokens match
one-for-one:

```mdx
---
import InterlinearGloss from "@bastion-falls/lexicon-components/InterlinearGloss.astro";
---

<InterlinearGloss
  source="barak'er-es 'aterimris"
  gloss="walk-VRB-ABS after"
  translation="after walking"
/>
```

Use explicit tokens when spacing or morphology needs more control. Prefer this
form for affixes, clitics, and fused forms so each morpheme can highlight on
its own:

```mdx
---
import InterlinearGloss from "@bastion-falls/lexicon-components/InterlinearGloss.astro";
import GlossSource from "@bastion-falls/lexicon-components/GlossSource.astro";
import GlossToken from "@bastion-falls/lexicon-components/GlossToken.astro";
import GlossTranslation from "@bastion-falls/lexicon-components/GlossTranslation.astro";
---

<InterlinearGloss>
  <GlossSource>barak'er-es 'aterimris</GlossSource>
  <GlossToken source="barak" gloss="walk" />
  <GlossToken source={"-'er"} gloss="VRB" type="suffix" />
  <GlossToken source="-es" gloss="ABS" type="suffix" />
  <GlossToken source="'aterimris" gloss="after" />
  <GlossTranslation>after walking</GlossTranslation>
</InterlinearGloss>
```

Token types:

| Type | Rendering intent |
| --- | --- |
| `word` | Default spacing. |
| `suffix` | Visually attaches to the previous token. |
| `prefix` | Visually attaches to the following token. |
| `clitic` | Uses reduced spacing. |

The rendered gloss is a compact card with horizontal overflow for long examples,
keyboard-focusable tokens, and separate source/gloss spans rather than a table.
`GlossSource` is optional; use it when the visible surface form should stay
unsplit while the source-token line shows the morphological analysis.

## TypeScript Helpers

The search helpers are available from `@bastion-falls/lexicon-components/search`:

```ts
import {
  buildLexiconEntrySearchHref,
  buildLexiconSearchHref,
  listLexiconEntries,
  listLexiconQuerySuggestions,
  paginateLexiconResults,
  searchLexicon,
} from "@bastion-falls/lexicon-components/search";
```

Useful helpers:

| Helper | Purpose |
| --- | --- |
| `searchLexicon(index, query, options)` | Filter and score entries. |
| `listLexiconEntries(index, options)` | Alphabetical listing for empty-query browsing. |
| `paginateLexiconResults(results, { page, pageSize })` | Slice result sets for display. |
| `listLexiconQuerySuggestions(index, query, options)` | Return `tag:`, `type:`, and `pos:` suggestions. |
| `buildLexiconSearchHref(lexiconUrl, query)` | Build a `?q=` search URL. |
| `buildLexiconEntrySearchHref(lexiconUrl, entry)` | Build an `?entry=` permalink. |

Gloss helpers are available from `@bastion-falls/lexicon-components/gloss`:

```ts
import {
  createGlossPairsFromLines,
  normalizeGlossPairs,
} from "@bastion-falls/lexicon-components/gloss";
```

`createGlossPairsFromLines(source, gloss)` is useful for shorthand input. It
throws when the source and gloss lines do not have the same number of tokens.

Types are available from `@bastion-falls/lexicon-components/types`.

## Search Index Shape

`LexiconSearchWorkbench` expects one generated `LexiconSearchIndex` per
language. The current generator lives in
`@bastion-falls/astro-lexicon-integration`.

At minimum, each entry should include:

- Stable entry `id`.
- `writtenForm` and `phoneticForm`.
- Lexical type IDs and normalized `typeLabels`.
- Sense definitions and optional usage examples.
- Semantic field labels and IDs.
- Optional audio sources for web playback.

The canonical distinction is:

| Concept | Meaning |
| --- | --- |
| `lexiconGlob` | Source JSON-LD files under `src/assets/...`. |
| `searchIndex` | Generated static JSON imported into MDX. |
| `lexiconUrl` | Public docs route used by the browser and permalinks. |

## Static Pages

The package still exports the older static lexicon components:

- `LexiconAlphaPage.astro`
- `LexiconByFieldPage.astro`
- `LexiconFieldPage.astro`
- `LexiconFieldsIndexPage.astro`
- `LexiconEntryBlock.astro`
- `LexiconNav.astro`
- `LexPagination.astro`

These remain available for compatibility, but the preferred primary interface is
`LexiconSearchWorkbench`.

## Development

Run package tests:

```sh
pnpm --filter @bastion-falls/lexicon-components test
pnpm --filter @bastion-falls/lexicon-components typecheck
```
