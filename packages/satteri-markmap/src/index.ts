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

const runtimeStyles = `.markmap-wrap {
  position: relative;
  height: max-content;
  width: 100%;
}

.markmap-wrap.fullscreen {
  background: #ffffff;
}

.markmap-dark .markmap-wrap.fullscreen {
  background: #1a1a1a;
}

.markmap-wrap > svg {
  width: 100%;
  height: auto;
  margin: 0;
  padding: 0;
}

.markmap-wrap.fullscreen > svg {
  height: 100%!important;
}

.mm-toolbar {
  position: absolute;
  right: .5em;
  bottom: .5em;
}`;

function renderMarkmaps() {
	const { Markmap, Toolbar, deriveOptions } = (
		window as unknown as { markmap: BrowserMarkmapApi }
	).markmap;
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
		fullscreenElement.addEventListener("fullscreenchange", () =>
			fullscreenElement.classList[
				document.fullscreenElement ? "add" : "remove"
			]("fullscreen"),
		);
		toolbar.setItems([...toolbar.items, "fullScreen"]);
		return toolbar.el;
	};

	document
		.querySelectorAll(".markmap-wrap:not([data-markmap-rendered])")
		.forEach((element) => {
			const [rootScript, optionsScript] = Array.from(
				element.children,
			) as HTMLElement[];
			if (!rootScript || !optionsScript) return;
			const root = JSON.parse(rootScript.innerHTML);
			const options = JSON.parse(optionsScript.innerHTML);
			element.setAttribute("data-markmap-rendered", "true");
			element.innerHTML = "<svg></svg>";
			const svg = element.querySelector("svg");
			const markmap = Markmap.create(svg, deriveOptions(options), root);
			element.append(
				createToolbar(markmap, { fullscreenElement: element as HTMLElement }),
			);
			resize.observe(
				element,
				debounce(() => {
					if (!svg) return;
					svg.style.height = `${markmap.state.rect.y2}px`;
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
	const html = `<div class="markmap-wrap"${id ? ` id="${escapeAttribute(id)}"` : ""}><script type="application/json">${escapeScript(JSON.stringify(root))}</script><script type="application/json">${escapeScript(JSON.stringify(jsonOptions))}</script></div>`;
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
		`<script>(${applyDarkTheme.toString()})(${darkThemeSelector.toString()});</script>`,
		'<script src="https://cdn.jsdelivr.net/npm/d3@7"></script>',
		'<script src="https://cdn.jsdelivr.net/npm/markmap-view"></script>',
		'<script src="https://cdn.jsdelivr.net/npm/markmap-toolbar"></script>',
		`<style>${runtimeStyles}</style>`,
		'<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/markmap-toolbar/dist/style.css"></link>',
		...assets,
		`<script>(${renderMarkmaps.toString()})();</script>`,
	].join("");
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

function escapeScript(value: string) {
	return value.replace(/</g, "\\u003c");
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
