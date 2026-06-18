import {
  createGlossPairsFromLines,
  normalizeGlossPairs,
} from "../gloss.ts";
import type { GlossPair, GlossPairInput } from "../types.ts";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function clearHighlights(root: ParentNode): void {
  root
    .querySelectorAll<HTMLElement>("[data-gloss-active]")
    .forEach((el) => el.removeAttribute("data-gloss-active"));
}

function setHighlight(root: ParentNode, pairId: string): void {
  clearHighlights(root);
  root
    .querySelectorAll<HTMLElement>(`[data-gloss-pair="${CSS.escape(pairId)}"]`)
    .forEach((el) => el.setAttribute("data-gloss-active", "true"));
}

function renderTokenLine(
  pairs: readonly GlossPair[],
  field: "source" | "gloss",
): string {
  return pairs
    .map(
      (pair) =>
        `<span class="bf-ig-token bf-ig-token--${field} bf-ig-token--${pair.type}" data-gloss-pair="${escapeHtml(pair.id)}" tabindex="0">${escapeHtml(pair[field])}</span>`,
    )
    .join("");
}

function renderGloss(pairs: readonly GlossPair[], translation: string): string {
  return `<style>
    .bf-ig {
      overflow-x: auto;
      margin: 1rem 0;
      padding: 0.75rem 0;
    }
    .bf-ig__line {
      align-items: baseline;
      display: flex;
      min-width: max-content;
    }
    .bf-ig__source {
      margin-bottom: 0.16rem;
    }
    .bf-ig-token {
      border-radius: 0.2rem;
      cursor: default;
      display: inline-block;
      padding: 0.08rem 0.14rem;
      white-space: nowrap;
    }
    .bf-ig-token + .bf-ig-token {
      margin-left: 0.58rem;
    }
    .bf-ig-token--suffix {
      margin-left: -0.06rem;
      padding-left: 0;
    }
    .bf-ig-token--prefix {
      margin-right: -0.06rem;
      padding-right: 0;
    }
    .bf-ig-token--clitic {
      margin-left: 0.16rem;
    }
    .bf-ig-token--source {
      color: var(--sl-color-white, currentColor);
      font-family: ui-serif, Georgia, serif;
      font-size: 1.05rem;
      font-weight: 650;
    }
    .bf-ig-token--gloss {
      color: var(--sl-color-gray-3, currentColor);
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 0.75rem;
      letter-spacing: 0;
      text-transform: uppercase;
    }
    .bf-ig-token[data-gloss-active="true"] {
      background: color-mix(in srgb, var(--sl-color-accent, #6366f1) 18%, transparent);
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--sl-color-accent, #6366f1) 35%, transparent);
    }
    .bf-ig__translation {
      color: var(--sl-color-gray-2, currentColor);
      font-style: italic;
      margin: 0.55rem 0 0;
    }
  </style>
  <div class="bf-ig" role="group" aria-label="Interlinear gloss">
    <div class="bf-ig__line bf-ig__source">${renderTokenLine(pairs, "source")}</div>
    <div class="bf-ig__line bf-ig__gloss">${renderTokenLine(pairs, "gloss")}</div>
    ${translation ? `<p class="bf-ig__translation">${escapeHtml(translation)}</p>` : ""}
  </div>`;
}

function pairsFromElement(element: HTMLElement): GlossPair[] {
  const source = element.dataset.source;
  const gloss = element.dataset.gloss;
  if (source && gloss) return createGlossPairsFromLines(source, gloss);

  const tokens = [...element.querySelectorAll<HTMLElement>("[data-gloss-token]")];
  const inputs: GlossPairInput[] = tokens.map((token) => ({
    source: token.dataset.source ?? "",
    gloss: token.dataset.gloss ?? "",
    type: token.dataset.type as GlossPairInput["type"],
  }));
  return normalizeGlossPairs(inputs);
}

function translationFromElement(element: HTMLElement): string {
  return (
    element.dataset.translation ??
    element.querySelector<HTMLElement>("[data-gloss-translation]")?.textContent?.trim() ??
    ""
  );
}

class BfInterlinearGlossElement extends HTMLElement {
  connectedCallback(): void {
    this.#render();
    this.addEventListener("pointerover", this.#activate);
    this.addEventListener("focusin", this.#activate);
    this.addEventListener("pointerout", this.#clear);
    this.addEventListener("focusout", this.#clear);
    this.addEventListener("click", this.#activate);
  }

  disconnectedCallback(): void {
    this.removeEventListener("pointerover", this.#activate);
    this.removeEventListener("focusin", this.#activate);
    this.removeEventListener("pointerout", this.#clear);
    this.removeEventListener("focusout", this.#clear);
    this.removeEventListener("click", this.#activate);
  }

  #activate = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const token = target.closest<HTMLElement>("[data-gloss-pair]");
    const pairId = token?.dataset.glossPair;
    if (!pairId) return;
    setHighlight(this, pairId);
  };

  #clear = (): void => {
    clearHighlights(this);
  };

  #render(): void {
    const pairs = pairsFromElement(this);
    const translation = translationFromElement(this);
    this.innerHTML = renderGloss(pairs, translation);
  }
}

if (!customElements.get("bf-interlinear-gloss")) {
  customElements.define("bf-interlinear-gloss", BfInterlinearGlossElement);
}
