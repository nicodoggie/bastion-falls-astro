import { dirname, parse, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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

interface AutoImport {
	localName: string;
	imported: string;
	modulePath: string;
}

const defaultInclude = (fileURL: URL | undefined) =>
	!fileURL || fileURL.pathname.endsWith(".mdx");

const preambleNodeTypes = new Set(["yaml", "toml"]);

export default function satteriAutoImport({
	imports,
	cwd = process.cwd(),
	include = defaultInclude,
}: SatteriAutoImportOptions): MdastPluginDefinition {
	const importsByLocalName = getAutoImports(imports);
	const importedByContext = new WeakMap<VisitorContext, Set<string>>();

	function insertImportsForUsedComponents(
		node: Readonly<MdastNode>,
		ctx: VisitorContext,
	) {
		if (!include(ctx.fileURL)) return;

		const usedImports = getUsedImports(node, importsByLocalName);
		if (usedImports.length === 0) return;

		const imported =
			importedByContext.get(ctx) ?? setImportedContext(ctx, importedByContext);
		const importValue = usedImports
			.map((autoImport) => formatAutoImport(autoImport, cwd, ctx.fileURL))
			.filter((importStatement) => !imported.has(importStatement))
			.map((autoImport) => {
				imported.add(autoImport);
				return autoImport;
			})
			.join("\n");
		if (!importValue) return;

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
		mdxJsxFlowElement: insertImportsForUsedComponents,
		paragraph: insertImportsForUsedComponents,
		heading: insertImportsForUsedComponents,
		blockquote: insertImportsForUsedComponents,
		list: insertImportsForUsedComponents,
		table: insertImportsForUsedComponents,
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

function getAutoImports(importsConfig: ImportsConfig) {
	const importsByLocalName = new Map<string, AutoImport[]>();

	for (const option of importsConfig) {
		for (const autoImport of getAutoImportsForOption(option)) {
			const autoImports = importsByLocalName.get(autoImport.localName) ?? [];
			autoImports.push(autoImport);
			importsByLocalName.set(autoImport.localName, autoImports);
		}
	}

	return importsByLocalName;
}

function getAutoImportsForOption(option: ImportsConfig[number]): AutoImport[] {
	if (typeof option === "string") {
		const localName = getDefaultImportName(option);
		return [
			{
				localName,
				imported: localName,
				modulePath: option,
			},
		];
	}

	return Object.entries(option).flatMap(
		([modulePath, namedImportsOrNamespace]) => {
			if (typeof namedImportsOrNamespace === "string") {
				const localName = namedImportsOrNamespace;
				return [
					{
						localName,
						imported: `* as ${localName}`,
						modulePath,
					},
				];
			}

			return namedImportsOrNamespace.map((namedImport) => {
				const localName = getNamedImportLocalName(namedImport);
				return {
					localName,
					imported: `{ ${formatNamedImport(namedImport)} }`,
					modulePath,
				};
			});
		},
	);
}

function formatAutoImport(
	autoImport: AutoImport,
	cwd: string,
	fileURL: URL | undefined,
) {
	return formatImport(
		autoImport.imported,
		resolveModulePath(autoImport.modulePath, cwd, fileURL),
	);
}

function setImportedContext(
	ctx: VisitorContext,
	importedByContext: WeakMap<VisitorContext, Set<string>>,
) {
	const imported = new Set<string>();
	importedByContext.set(ctx, imported);
	return imported;
}

function getUsedImports(
	node: Readonly<MdastNode>,
	importsByLocalName: ReadonlyMap<string, AutoImport[]>,
) {
	const usedImports: AutoImport[] = [];
	const seenAutoImports = new Set<string>();

	for (const componentName of getComponentNames(node)) {
		const localName = componentName.split(".")[0];
		if (!localName) continue;
		const autoImports = importsByLocalName.get(localName) ?? [];
		for (const autoImport of autoImports) {
			const key = `${autoImport.imported}\0${autoImport.modulePath}`;
			if (seenAutoImports.has(key)) continue;
			seenAutoImports.add(key);
			usedImports.push(autoImport);
		}
	}

	return usedImports;
}

function getComponentNames(node: Readonly<MdastNode>) {
	const names = new Set<string>();
	visitNode(node, (current) => {
		if (
			(current.type === "mdxJsxFlowElement" ||
				current.type === "mdxJsxTextElement") &&
			typeof current.name === "string"
		) {
			names.add(current.name);
		}
	});
	return names;
}

function visitNode(
	node: Readonly<MdastNode>,
	visitor: (node: Readonly<MdastNode>) => void,
) {
	visitor(node);
	if (!("children" in node) || !Array.isArray(node.children)) return;
	for (const child of node.children) {
		if (child && typeof child === "object")
			visitNode(child as MdastNode, visitor);
	}
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

function getNamedImportLocalName(namedImport: NamedImportConfig) {
	if (typeof namedImport === "string") return namedImport;
	const [, as] = namedImport;
	return as;
}

function resolveModulePath(
	modulePath: string,
	cwd: string,
	fileURL?: URL | undefined,
) {
	if (!modulePath.startsWith(".")) return modulePath;
	const absoluteModulePath = resolve(cwd, modulePath);
	if (!fileURL) return absoluteModulePath;

	const importerPath = fileURLToPath(fileURL);
	let relativeModulePath = relative(dirname(importerPath), absoluteModulePath);
	relativeModulePath = relativeModulePath.replaceAll("\\", "/");
	if (!relativeModulePath.startsWith(".")) {
		relativeModulePath = `./${relativeModulePath}`;
	}
	return relativeModulePath;
}
