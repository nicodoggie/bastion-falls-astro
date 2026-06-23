import matter from "gray-matter";
import { persistCSS, persistJS } from "markmap-common";
import { Transformer } from "markmap-lib";
import type { MdastPluginDefinition } from "satteri";
import { defineMdastPlugin } from "satteri";

export interface SatteriMarkmapOptions {
	darkThemeSelector?: () => string | boolean;
}

interface MarkmapFrontmatter {
	id?: unknown;
	markmap?: unknown;
	options?: unknown;
}

interface BrowserMarkmapApi {
	Markmap: {
		create(
			svg: SVGSVGElement | string | null,
			options: unknown,
			root: unknown,
		): RenderedMarkmap;
	};
	Toolbar: {
		create(markmap: RenderedMarkmap): MarkmapToolbar;
		icon(path: string): string;
	};
	deriveOptions(options: unknown): unknown;
}

interface RenderedMarkmap {
	state: {
		rect: {
			y2: number;
		};
	};
	fit(): void;
}

interface MarkmapToolbar {
	items: string[];
	el: HTMLElement;
	setBrand(enabled: boolean): void;
	register(item: {
		id: string;
		title: string;
		content: string;
		onClick(): void;
	}): void;
	setItems(items: string[]): void;
}

const transformer = new Transformer();

const defaultOptions: Required<SatteriMarkmapOptions> = {
	darkThemeSelector: () =>
		document.documentElement.matches(".dark") ||
		(window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false),
};

function renderMarkmaps() {
	const { Markmap, Toolbar, deriveOptions } = (
		window as unknown as { markmap: BrowserMarkmapApi }
	).markmap;
	const parseEncodedJson = (value: string | undefined) => {
		if (!value) return {};
		const bytes = Uint8Array.from(atob(value), (character) =>
			character.charCodeAt(0),
		);
		return JSON.parse(new TextDecoder().decode(bytes));
	};
	const resize = {
		event: new Event("resize"),
		observer: new ResizeObserver((entries) => {
			entries.forEach((entry) => {
				entry.target.dispatchEvent(resize.event);
			});
		}),
		observe(element: Element, listener: EventListener) {
			resize.observer.observe(element);
			element.addEventListener("resize", listener);
		},
	};
	const debounce = (fn: (...args: unknown[]) => void, delay: number) => {
		let timeout: ReturnType<typeof setTimeout>;
		return function debounced(this: unknown, ...args: unknown[]) {
			clearTimeout(timeout);
			timeout = setTimeout(() => fn.apply(this, args), delay);
		};
	};
	const createToolbar = (
		markmap: RenderedMarkmap,
		{ fullscreenElement }: { fullscreenElement: HTMLElement },
	) => {
		const toolbar = Toolbar.create(markmap);
		toolbar.setBrand(false);
		toolbar.register({
			id: "fullScreen",
			title: "Full Screen View",
			content: Toolbar.icon(
				"M4 9v-4h4v2h-2v2zM4 11v4h4v-2h-2v-2zM16 9v-4h-4v2h2v2zM16 11v4h-4v-2h2v-2z",
			),
			onClick: () =>
				document.fullscreenElement
					? document.exitFullscreen()
					: fullscreenElement.requestFullscreen(),
		});
		fullscreenElement.addEventListener("fullscreenchange", () => {
			if (document.fullscreenElement) {
				fullscreenElement.classList.add("fullscreen");
			} else {
				fullscreenElement.classList.remove("fullscreen");
			}
		});
		Object.assign(toolbar.el.style, {
			position: "absolute",
			right: ".5em",
			bottom: ".5em",
		});
		toolbar.setItems([...toolbar.items, "fullScreen"]);
		return toolbar.el;
	};

	document
		.querySelectorAll(".markmap-wrap:not([data-markmap-rendered])")
		.forEach((element) => {
			const htmlElement = element as HTMLElement;
			const root = parseEncodedJson(htmlElement.dataset.markmapRoot);
			const options = parseEncodedJson(htmlElement.dataset.markmapOptions);
			element.setAttribute("data-markmap-rendered", "true");
			element.innerHTML = "<svg></svg>";
			Object.assign(htmlElement.style, {
				position: "relative",
				width: "100%",
				height: "max-content",
			});
			const svg = element.querySelector("svg");
			if (svg) {
				Object.assign(svg.style, {
					width: "100%",
					height: "auto",
					margin: "0",
					padding: "0",
				});
			}
			const markmap = Markmap.create(svg, deriveOptions(options), root);
			element.append(
				createToolbar(markmap, { fullscreenElement: htmlElement }),
			);
			resize.observe(
				element,
				debounce(() => {
					if (!svg) return;
					svg.style.height = String(markmap.state.rect.y2).concat("px");
					markmap.fit();
				}, 100),
			);
		});
}

export default function satteriMarkmap({
	darkThemeSelector = defaultOptions.darkThemeSelector,
}: SatteriMarkmapOptions = {}): MdastPluginDefinition {
	return defineMdastPlugin({
		name: "markmap",
		code(node) {
			if (node.lang !== "markmap") return;
			return { rawHtml: renderMarkmapHtml(node.value, { darkThemeSelector }) };
		},
	});
}

export function renderMarkmapHtml(
	value: string,
	{
		darkThemeSelector = defaultOptions.darkThemeSelector,
	}: SatteriMarkmapOptions = {},
) {
	const { data, content } = matter(value);
	const { id, jsonOptions } = getFrontmatterOptions(data);
	const { root, features } = transformer.transform(content);
	const { styles = [], scripts = [] } = transformer.getUsedAssets(features);
	const html = `<div class="markmap-wrap"${id ? ` id="${escapeAttribute(id)}"` : ""} data-markmap-root="${toBase64(JSON.stringify(root))}" data-markmap-options="${toBase64(JSON.stringify(jsonOptions))}"></div>`;
	const assets = [
		...persistCSS(styles),
		...persistJS(scripts, {
			getMarkmap: () =>
				(window as unknown as { markmap: BrowserMarkmapApi }).markmap,
			root,
		}),
	];

	return [
		html,
		renderInlineScript(
			`(${applyDarkTheme.toString()})(${darkThemeSelector.toString()});`,
		),
		'<script src="https://cdn.jsdelivr.net/npm/d3@7"></script>',
		'<script src="https://cdn.jsdelivr.net/npm/markmap-view"></script>',
		'<script src="https://cdn.jsdelivr.net/npm/markmap-toolbar"></script>',
		'<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/markmap-toolbar/dist/style.css"></link>',
		...assets.map(renderAsset),
		renderInlineScript(`(${renderMarkmaps.toString()})();`),
	].join("");
}

function renderInlineScript(value: string) {
	return `<script src="${toDataUrl("text/javascript", value)}"></script>`;
}

function renderAsset(value: string) {
	const scriptMatch = value.match(/^<script>([\s\S]*)<\/script>$/i);
	if (scriptMatch?.[1]) return renderInlineScript(scriptMatch[1]);

	const styleMatch = value.match(/^<style>([\s\S]*)<\/style>$/i);
	if (styleMatch?.[1]) {
		return `<link rel="stylesheet" href="${toDataUrl("text/css", styleMatch[1])}"></link>`;
	}

	return value;
}

function toDataUrl(mimeType: string, value: string) {
	return `data:${mimeType};base64,${toBase64(value)}`;
}

function toBase64(value: string) {
	return Buffer.from(value, "utf8").toString("base64");
}

function getFrontmatterOptions(data: MarkmapFrontmatter) {
	const id = typeof data.id === "string" ? data.id : undefined;
	const jsonOptions =
		isRecord(data.markmap) || Array.isArray(data.markmap)
			? data.markmap
			: isRecord(data.options) || Array.isArray(data.options)
				? data.options
				: {};

	return { id, jsonOptions };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeAttribute(value: string) {
	return value.replace(/["&<>]/g, (character) => {
		switch (character) {
			case '"':
				return "&quot;";
			case "&":
				return "&amp;";
			case "<":
				return "&lt;";
			case ">":
				return "&gt;";
			default:
				return character;
		}
	});
}

function applyDarkTheme(darkThemeSelector: () => string | boolean) {
	const selected = darkThemeSelector();
	if (
		selected === true ||
		(typeof selected === "string" && document.documentElement.matches(selected))
	) {
		document.documentElement.classList.add("markmap-dark");
	}
}
