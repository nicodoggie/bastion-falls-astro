import assert from "node:assert/strict";
import { test } from "node:test";

import satteriMarkmap, { renderMarkmapHtml } from "./index.ts";

test("creates a Satteri mdast plugin for markmap code fences", () => {
	const plugin = satteriMarkmap();

	assert.equal(plugin.name, "markmap");
	assert.equal(typeof plugin.code, "function");
});

test("renders markmap code fences as markmap wrapper HTML", () => {
	const html = renderMarkmapHtml("# Root\n\n## Branch");

	assert.match(html, /<div class="markmap-wrap">/);
	assert.match(html, /<script type="application\/json">/);
	assert.match(html, /markmap-view/);
	assert.match(html, /markmap-toolbar/);
	assert.match(
		html,
		/querySelectorAll\("\.markmap-wrap:not\(\[data-markmap-rendered\]\)"\)/,
	);
});

test("reads frontmatter id and markmap options", () => {
	const html = renderMarkmapHtml(`---
id: map-"one"
markmap:
  colorFreezeLevel: 2
---

# Root`);

	assert.match(html, /id="map-&quot;one&quot;"/);
	assert.match(html, /"colorFreezeLevel":2/);
});

test("escapes JSON script content", () => {
	const html = renderMarkmapHtml("# <script>alert(1)</script>");

	assert.doesNotMatch(html, /<script>alert/);
	assert.match(html, /\\u003cscript/);
});
