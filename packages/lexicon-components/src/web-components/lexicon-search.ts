import {
  listLexiconEntries,
  paginateLexiconResults,
  searchLexicon,
} from "../search.ts";
import { renderLexiconSearchResult } from "../search-render.ts";
import type { LexiconSearchIndex } from "../types.ts";

interface LexiconSearchConfig {
  searchIndex: LexiconSearchIndex;
  lexiconUrl: string;
  initialQuery: string;
  resultLimit: number;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderPager(page: number, pageCount: number): string {
  if (pageCount <= 1) return "";
  return `<nav class="lex-search-pagination" aria-label="Lexicon result pages">
    <button type="button" data-lex-page="prev" ${page <= 1 ? "disabled" : ""}>Previous</button>
    <span>Page ${String(page)} of ${String(pageCount)}</span>
    <button type="button" data-lex-page="next" ${page >= pageCount ? "disabled" : ""}>Next</button>
  </nav>`;
}

class BfLexiconSearchElement extends HTMLElement {
  #config: LexiconSearchConfig | null = null;
  #currentPage = 1;
  #currentQuery = "";

  connectedCallback(): void {
    const raw = this.getAttribute("data-config");
    if (!raw) return;
    this.#config = JSON.parse(raw) as LexiconSearchConfig;
    this.#render();
  }

  #render(): void {
    if (!this.#config) return;
    this.innerHTML = `<style>
      .lex-search-workbench {
        display: grid;
        gap: 0.75rem;
        margin: 1rem 0;
      }
      .lex-search-label {
        display: grid;
        gap: 0.35rem;
      }
      .lex-search-input {
        border: 1px solid var(--sl-color-gray-5, #d1d5db);
        border-radius: 0.35rem;
        font: inherit;
        padding: 0.45rem 0.55rem;
        width: 100%;
      }
      .lex-search-help,
      .lex-search-status {
        color: var(--sl-color-gray-3, currentColor);
        font-size: 0.9rem;
        margin: 0;
      }
      .lex-search-result {
        border-top: 1px solid var(--sl-color-gray-6, #e5e7eb);
        padding: 0.45rem 0;
      }
      .lex-search-row-wrap {
        align-items: start;
      }
      .lex-search-row {
        color: inherit;
        display: grid;
        font: inherit;
        gap: 0.2rem;
        grid-template-columns: minmax(0, 1fr) auto;
        padding: 0;
        text-align: left;
        width: 100%;
      }
      .lex-search-summary-content {
        display: grid;
        gap: 0.2rem;
        min-width: 0;
      }
      .lex-search-summary-main {
        align-items: baseline;
        display: flex;
        flex-wrap: wrap;
        gap: 0.35rem;
      }
      .lex-search-word {
        font-weight: 700;
      }
      .lex-search-pronunciation {
        align-items: center;
        display: inline-flex;
        gap: 0.18rem;
      }
      .lex-search-phonetic,
      .lex-search-preview,
      .lex-search-reasons {
        color: var(--sl-color-gray-3, currentColor);
      }
      .lex-search-type {
        border: 1px solid var(--sl-color-gray-5, #d1d5db);
        border-radius: 999px;
        color: var(--sl-color-gray-2, currentColor);
        font-size: 0.74rem;
        line-height: 1;
        padding: 0.16rem 0.38rem;
        text-transform: lowercase;
      }
      .lex-search-audio-button {
        align-items: center;
        appearance: none;
        background: transparent;
        border: 0;
        border-radius: 999px;
        color: var(--sl-color-gray-3, currentColor);
        cursor: pointer;
        display: inline-grid;
        height: 1.35rem;
        justify-content: center;
        padding: 0;
        width: 1.35rem;
      }
      .lex-search-audio-button:hover,
      .lex-search-audio-button:focus-visible {
        background: var(--sl-color-gray-6, rgba(148, 163, 184, 0.2));
        color: var(--sl-color-text, currentColor);
      }
      .lex-search-audio-button[aria-pressed="true"] {
        color: var(--sl-color-accent, currentColor);
      }
      .lex-search-audio-icon {
        fill: currentColor;
        height: 0.95rem;
        stroke: currentColor;
        stroke-linecap: round;
        stroke-linejoin: round;
        stroke-width: 2;
        width: 0.95rem;
      }
      .lex-search-audio {
        display: none;
      }
      .sr-only {
        border: 0;
        clip: rect(0, 0, 0, 0);
        height: 1px;
        margin: -1px;
        overflow: hidden;
        padding: 0;
        position: absolute;
        white-space: nowrap;
        width: 1px;
      }
      .lex-search-preview {
        display: grid;
        font-size: 0.9rem;
        gap: 0.08rem;
        padding-left: 0.05rem;
      }
      .lex-search-senses {
        display: grid;
        gap: 0.18rem;
        margin: 0.5rem 0;
        padding-left: 1.1rem;
      }
      .lex-search-disclosure {
        align-self: center;
        border-bottom: 1.5px solid currentColor;
        border-right: 1.5px solid currentColor;
        color: var(--sl-color-gray-3, currentColor);
        height: 0.45rem;
        transform: rotate(-45deg);
        transition: transform 120ms ease;
        width: 0.45rem;
      }
      .lex-search-disclosure-button {
        align-items: center;
        appearance: none;
        background: transparent;
        border: 0;
        border-radius: 999px;
        color: inherit;
        cursor: pointer;
        display: inline-flex;
        height: 1.75rem;
        justify-content: center;
        margin-left: 0.75rem;
        padding: 0;
        width: 1.75rem;
      }
      .lex-search-disclosure-button:hover,
      .lex-search-disclosure-button:focus-visible {
        background: var(--sl-color-gray-6, rgba(148, 163, 184, 0.2));
      }
      .lex-search-disclosure-button[aria-expanded="true"] .lex-search-disclosure {
        transform: rotate(45deg);
      }
      .lex-search-pagination {
        align-items: center;
        display: flex;
        gap: 0.65rem;
        justify-content: flex-end;
        margin-top: 0.75rem;
      }
      .lex-search-pagination button {
        border: 1px solid var(--sl-color-gray-5, #d1d5db);
        border-radius: 0.3rem;
        font: inherit;
        padding: 0.25rem 0.5rem;
      }
    </style>
    <section class="lex-search-workbench">
      <label class="lex-search-label">
        <span>Search ${escapeHtml(this.#config.searchIndex.title)}</span>
        <input class="lex-search-input" type="search" value="${escapeHtml(this.#config.initialQuery)}" placeholder="Try word:thral, def:revelation, tag:sacred, type:noun" />
      </label>
      <p class="lex-search-help">Use prefixes like <code>word:</code>, <code>def:</code>, <code>tag:</code>, or <code>type:</code>. <code>pos:</code> also works for type.</p>
      <div class="lex-search-status" aria-live="polite"></div>
      <div class="lex-search-results"></div>
    </section>`;

    const input = this.querySelector<HTMLInputElement>(".lex-search-input");
    input?.addEventListener("input", () => {
      this.#currentPage = 1;
      this.#renderResults(input.value);
    });
    this.#renderResults(this.#config.initialQuery);
  }

  #renderResults(query: string): void {
    if (!this.#config) return;
    this.#currentQuery = query;
    const status = this.querySelector<HTMLElement>(".lex-search-status");
    const resultsEl = this.querySelector<HTMLElement>(".lex-search-results");
    if (!status || !resultsEl) return;
    const isBrowsing = !query.trim();
    const results = isBrowsing
      ? listLexiconEntries(this.#config.searchIndex)
      : searchLexicon(this.#config.searchIndex, query);
    const page = paginateLexiconResults(results, {
      page: this.#currentPage,
      pageSize: this.#config.resultLimit,
    });
    this.#currentPage = page.page;
    const start = page.total === 0 ? 0 : (page.page - 1) * page.pageSize + 1;
    const end = Math.min(page.total, page.page * page.pageSize);
    const resultNoun = isBrowsing ? "entr" : "result";
    const plural = page.total === 1 ? (isBrowsing ? "y" : "") : (isBrowsing ? "ies" : "s");
    status.textContent = page.total
      ? `Showing ${String(start)}-${String(end)} of ${String(page.total)} ${resultNoun}${plural}`
      : "No results";
    resultsEl.innerHTML = `${page.items
      .map((result) => renderLexiconSearchResult(this.#config?.lexiconUrl ?? "", result))
      .join("")}${renderPager(page.page, page.pageCount)}`;
    this.#bindResultToggles();
    this.#bindAudioButtons();
    this.#bindPagination();
  }

  #bindResultToggles(): void {
    this.querySelectorAll<HTMLButtonElement>("[data-lex-toggle]").forEach((button) => {
      button.addEventListener("click", () => {
        const panelId = button.getAttribute("aria-controls");
        const panel = panelId ? this.querySelector<HTMLElement>(`#${CSS.escape(panelId)}`) : null;
        if (!panel) return;
        const expanded = button.getAttribute("aria-expanded") === "true";
        button.setAttribute("aria-expanded", expanded ? "false" : "true");
        panel.hidden = expanded;
      });
    });
  }

  #bindAudioButtons(): void {
    this.querySelectorAll<HTMLButtonElement>("[data-lex-audio]").forEach((button) => {
      button.addEventListener("click", async () => {
        const audioId = button.getAttribute("aria-controls");
        const audio = audioId ? this.querySelector<HTMLAudioElement>(`#${CSS.escape(audioId)}`) : null;
        if (!audio) return;
        this.querySelectorAll<HTMLAudioElement>("audio.lex-search-audio").forEach((other) => {
          if (other === audio) return;
          other.pause();
          other.currentTime = 0;
        });
        this.querySelectorAll<HTMLButtonElement>("[data-lex-audio]").forEach((other) => {
          if (other !== button) other.removeAttribute("aria-pressed");
        });
        audio.currentTime = 0;
        button.setAttribute("aria-pressed", "true");
        audio.addEventListener("ended", () => button.removeAttribute("aria-pressed"), { once: true });
        audio.addEventListener("pause", () => button.removeAttribute("aria-pressed"), { once: true });
        try {
          await audio.play();
        } catch {
          button.removeAttribute("aria-pressed");
        }
      });
    });
  }

  #bindPagination(): void {
    this.querySelectorAll<HTMLButtonElement>("[data-lex-page]").forEach((button) => {
      button.addEventListener("click", () => {
        const direction = button.dataset.lexPage;
        this.#currentPage += direction === "next" ? 1 : -1;
        this.#renderResults(this.#currentQuery);
      });
    });
  }
}

if (!customElements.get("bf-lexicon-search")) {
  customElements.define("bf-lexicon-search", BfLexiconSearchElement);
}
