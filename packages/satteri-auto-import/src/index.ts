import { parse, resolve } from "node:path";
import type { MdastNode, MdastPluginDefinition } from "satteri";
import { defineMdastPlugin } from "satteri";

export type NamedImportConfig = string | [from: string, as: string];
export type ImportsConfig = (
	| string
	| Record<string, string | NamedImportConfig[]>
)[];

export interface SatteriAutoImportOptions {
	imports: ImportsConfig;
	cwd?: string;
	include?: (fileURL: URL | undefined) => boolean;
}

interface VisitorContext {
	fileURL: URL | undefined;
	insertBefore(node: Readonly<MdastNode>, newNode: MdastNode): void;
	insertAfter(node: Readonly<MdastNode>, newNode: MdastNode): void;
}

const defaultInclude = (fileURL: URL | undefined) =>
	!fileURL || fileURL.pathname.endsWith(".mdx");

const preambleNodeTypes = new Set(["yaml", "toml"]);

export default function satteriAutoImport({
	imports,
	cwd = process.cwd(),
	include = defaultInclude,
}: SatteriAutoImportOptions): MdastPluginDefinition {
	const importedContexts = new WeakSet<VisitorContext>();
	const importValue = formatAutoImports(imports, { cwd });

	function insertImports(node: Readonly<MdastNode>, ctx: VisitorContext) {
		if (importedContexts.has(ctx) || !include(ctx.fileURL)) return;

		importedContexts.add(ctx);
		const importNode: MdastNode = {
			type: "mdxjsEsm",
			value: importValue,
		};

		if (preambleNodeTypes.has(node.type)) {
			ctx.insertAfter(node, importNode);
		} else {
			ctx.insertBefore(node, importNode);
		}
	}

	return defineMdastPlugin({
		name: "auto-import",
		yaml: insertImports,
		toml: insertImports,
		mdxjsEsm: insertImports,
		mdxJsxFlowElement: insertImports,
		paragraph: insertImports,
		heading: insertImports,
		thematicBreak: insertImports,
		blockquote: insertImports,
		list: insertImports,
		code: insertImports,
		html: insertImports,
	});
}

export function formatAutoImports(
	importsConfig: ImportsConfig,
	{ cwd = process.cwd() }: { cwd?: string } = {},
) {
	return importsConfig
		.map((option) => formatImportOption(option, cwd))
		.join("\n");
}

function formatImportOption(
	option: ImportsConfig[number],
	cwd: string,
): string {
	if (typeof option === "string") {
		return formatImport(
			getDefaultImportName(option),
			resolveModulePath(option, cwd),
		);
	}

	return Object.entries(option)
		.map(([modulePath, namedImportsOrNamespace]) => {
			const module = resolveModulePath(modulePath, cwd);
			if (typeof namedImportsOrNamespace === "string") {
				return formatImport(`* as ${namedImportsOrNamespace}`, module);
			}

			return formatImport(formatNamedImports(namedImportsOrNamespace), module);
		})
		.join("\n");
}

function getDefaultImportName(modulePath: string) {
	return parse(modulePath).name.replaceAll(/[^\w\d]/g, "");
}

function formatImport(imported: string, module: string) {
	return `import ${imported} from ${JSON.stringify(module)};`;
}

function formatNamedImports(namedImports: NamedImportConfig[]) {
	return `{ ${namedImports.map(formatNamedImport).join(", ")} }`;
}

function formatNamedImport(namedImport: NamedImportConfig) {
	if (typeof namedImport === "string") return namedImport;
	const [from, as] = namedImport;
	return `${from} as ${as}`;
}

function resolveModulePath(modulePath: string, cwd: string) {
	if (modulePath.startsWith(".")) return resolve(cwd, modulePath);
	return modulePath;
}
