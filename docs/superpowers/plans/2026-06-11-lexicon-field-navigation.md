# Lexicon Field Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace brittle semantic-field pagination links with stable field pages and lexicon-local navigation that remains static, searchable, and sidebar-friendly.

**Architecture:** The lexicon integration continues to compile JSON-LD into generated JSON chunks and Starlight MDX pages. Alphabetical pagination remains page-based, while semantic fields gain stable `/field/<slug>` pages plus a `/fields` index. Shared Astro components render the lexicon quick reference in generated pages as static HTML.

**Tech Stack:** Astro, Starlight, MDX, Pagefind via Starlight, Vitest, TypeScript.

---

### Task 1: Generator Data and MDX Routes

**Files:**
- Modify: `packages/astro-lexicon-integration/src/generate-site.ts`
- Modify: `packages/astro-lexicon-integration/src/manifest.ts`
- Modify: `packages/astro-lexicon-integration/src/starlight-mdx.ts`
- Test: `packages/astro-lexicon-integration/test/generate-site.test.ts`
- Test: `packages/astro-lexicon-integration/test/starlight-mdx.test.ts`

- [ ] Add failing tests for per-field JSON chunks, field-route metadata, hidden/indexable field frontmatter, and the visible field index page.
- [ ] Implement field chunk output from the existing flattened semantic-field rows.
- [ ] Extend the manifest with ordered field route metadata.
- [ ] Generate `/fields.mdx` and `/field/<field-slug>.mdx` Starlight docs.

### Task 2: Lexicon Navigation Components

**Files:**
- Create: `packages/lexicon-components/src/LexiconNav.astro`
- Create: `packages/lexicon-components/src/LexiconFieldsIndexPage.astro`
- Create: `packages/lexicon-components/src/LexiconFieldPage.astro`
- Modify: `packages/lexicon-components/src/LexiconAlphaPage.astro`
- Modify: `packages/lexicon-components/package.json`

- [ ] Render a compact lexicon quick reference with links to alphabetical and semantic-field browse modes.
- [ ] Render the all-fields list in a collapsed `<details>` block.
- [ ] Highlight the current field on field pages.
- [ ] Include the nav on alphabetical, fields-index, and individual field pages.

### Task 3: Content Link Migration

**Files:**
- Modify: `astro/src/content/docs/world/languages/hickic/seneran/early-hick/lexicon.mdx`
- Modify: `astro/src/content/docs/world/languages/hickic/seneran/early-hick/index.mdx`

- [ ] Replace old `/lexicon/by-field/<page>#<field>` links with stable `/lexicon/field/<field>` links.
- [ ] Point browse-mode prose at `/lexicon/fields`.

### Task 4: Verification

**Commands:**
- `pnpm --filter @bastion-falls/astro-lexicon-integration test`
- `pnpm --filter @bastion-falls/astro build`

- [ ] Confirm generator tests pass.
- [ ] Confirm Astro build regenerates pages and Pagefind-indexable static output without schema or route errors.
