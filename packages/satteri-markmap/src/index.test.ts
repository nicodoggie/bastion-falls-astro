import assert from "node:assert/strict";
import { test } from "node:test";
import { mdxToJs } from "satteri";

import satteriMarkmap, { renderMarkmapHtml } from "./index.ts";

test("creates a Satteri mdast plugin for markmap code fences", () => {
	const plugin = satteriMarkmap();

	assert.equal(plugin.name, "markmap");
	assert.equal(typeof plugin.code, "function");
});

test("renders markmap code fences as markmap wrapper HTML", () => {
	const html = renderMarkmapHtml("# Root\n\n## Branch");

	assert.match(html, /<div class="markmap-wrap" /);
	assert.match(html, /data-markmap-root="/);
	assert.match(html, /data-markmap-options="/);
	assert.doesNotMatch(html, /<script type="application\/json">/);
	assert.match(html, /script src="data:text\/javascript;base64,/);
	assert.match(html, /markmap-view/);
	assert.match(html, /markmap-toolbar/);
	assert.doesNotMatch(html, /dangerouslySetInnerHTML/);
	assert.doesNotMatch(html, /<style/);
});

test("compiles runtime scripts without leaking CSS or emptying script bodies", () => {
	const fence = "```";
	const result = mdxToJs(`${fence}markmap\n# Root\n\n## Branch\n${fence}`, {
		mdastPlugins: [
			() =>
				satteriMarkmap({
					darkThemeSelector: () => false,
				}),
		],
	});

	assert.doesNotMatch(result.code, /dangerouslySetInnerHTML/);
	assert.doesNotMatch(result.code, /_components\.p/);
	assert.doesNotMatch(result.code, /_components\.a/);
	assert.doesNotMatch(result.code, /_components\.code/);
	assert.doesNotMatch(result.code, /[“”‘’]/);
	assert.doesNotMatch(result.code, /<p>.*<script/s);
	assert.doesNotMatch(result.code, /&lt;div class/);
	assert.match(result.code, /data:text\/javascript;base64,/);
	assert.match(result.code, /data-markmap-root/);
});

test("reads frontmatter id and markmap options", () => {
	const html = renderMarkmapHtml(`---
id: map-"one"
markmap:
  colorFreezeLevel: 2
---

# Root`);

	assert.match(html, /id="map-&quot;one&quot;"/);
	assert.deepEqual(decodeAttributeJson(html, "data-markmap-options"), {
		colorFreezeLevel: 2,
	});
});

test("encodes JSON content outside script bodies", () => {
	const html = renderMarkmapHtml("# <script>alert(1)</script>");

	assert.doesNotMatch(html, /<script>alert/);
	assert.doesNotMatch(html, /<script type="application\/json">/);
	assert.match(html, /data-markmap-root="/);
});

function decodeAttributeJson(html: string, name: string) {
	const match = html.match(new RegExp(`${name}="([^"]+)"`));
	assert.ok(match?.[1]);
	return JSON.parse(Buffer.from(match[1], "base64").toString("utf8"));
}
