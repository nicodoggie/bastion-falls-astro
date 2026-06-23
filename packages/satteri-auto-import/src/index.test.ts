import assert from "node:assert/strict";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { mdxToJs } from "satteri";

import satteriAutoImport, { formatAutoImports } from "./index.ts";

const imports = [
	"./src/components/FamilyTree.tsx",
	{
		"astro-embed": ["Tweet", ["YouTube", "Video"]],
		"./src/components/index.ts": "Components",
	},
];

test("formats default, named, aliased, and namespace imports", () => {
	assert.equal(
		formatAutoImports(imports, { cwd: "/site" }),
		[
			'import FamilyTree from "/site/src/components/FamilyTree.tsx";',
			'import { Tweet, YouTube as Video } from "astro-embed";',
			'import * as Components from "/site/src/components/index.ts";',
		].join("\n"),
	);
});

test("injects imports into MDX before component usage", () => {
	const result = mdxToJs("<FamilyTree />", {
		mdastPlugins: [
			() =>
				satteriAutoImport({
					imports: ["./src/components/FamilyTree.tsx"],
					cwd: "/site",
				}),
		],
	});

	assert.match(
		result.code,
		/import FamilyTree from "\/site\/src\/components\/FamilyTree\.tsx";/,
	);
	assert.match(result.code, /_jsx\(FamilyTree,/);
});

test("only injects imports for components used in the MDX document", () => {
	const result = mdxToJs("<FamilyTree />", {
		mdastPlugins: [
			() =>
				satteriAutoImport({
					imports: [
						"./src/components/FamilyTree.tsx",
						"./src/components/Stub.astro",
					],
					cwd: "/site",
				}),
		],
	});

	assert.match(
		result.code,
		/import FamilyTree from "\/site\/src\/components\/FamilyTree\.tsx";/,
	);
	assert.doesNotMatch(result.code, /import Stub/);
});

test("injects imports after MDX frontmatter", () => {
	const result = mdxToJs("---\ntitle: Family\n---\n\n<FamilyTree />", {
		features: { frontmatter: true },
		fileURL: pathToFileURL("/site/src/content/docs/world/locations/alsace.mdx"),
		mdastPlugins: [
			() =>
				satteriAutoImport({
					imports: ["./src/components/FamilyTree.tsx"],
					cwd: "/site",
				}),
		],
	});

	assert.match(
		result.code,
		/import FamilyTree from "\.\.\/\.\.\/\.\.\/\.\.\/components\/FamilyTree\.tsx";/,
	);
	assert.match(result.code, /_jsx\(FamilyTree,/);
});

test("does not inject imports into markdown files with file URLs", () => {
	const result = mdxToJs("<FamilyTree />", {
		fileURL: pathToFileURL("/site/src/content/docs/family.md"),
		mdastPlugins: [
			() =>
				satteriAutoImport({
					imports: ["./src/components/FamilyTree.tsx"],
					cwd: "/site",
				}),
		],
	});

	assert.doesNotMatch(result.code, /import FamilyTree/);
});
