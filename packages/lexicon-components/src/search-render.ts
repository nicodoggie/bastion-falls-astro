import {
  buildLexiconEntrySearchHref,
  listLexiconQuerySuggestions,
  listLexiconTagQuerySuggestions,
  listLexiconTypeBadges,
  summarizeLexiconSenses,
} from "./search";
import type {
  LexiconSearchAudio,
  LexiconSearchIndex,
  LexiconSearchResult,
  LexiconSearchSense,
} from "./types";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function stableDomId(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "entry";
}

function renderSenseLines(definitions: readonly string[], className: string): string {
  if (!definitions.length) return "";
  return `<span class="${className}">${definitions
    .map((definition) => `<span>${escapeHtml(definition)}</span>`)
    .join("")}</span>`;
}

function renderDetailSenses(senses: readonly LexiconSearchSense[]): string {
  const definitions = senses.map((sense) => sense.definition).filter(Boolean);
  if (!definitions.length) return "";
  return `<ul class="lex-search-senses">${definitions
    .map((definition) => `<li>${escapeHtml(definition)}</li>`)
    .join("")}</ul>`;
}

function renderAudioButton(
  audio: LexiconSearchAudio | undefined,
  audioId: string,
  writtenForm: string,
): string {
  const sources = audio?.sources.filter((source) => source.url && source.type) ?? [];
  if (!sources.length) return "";
  const label = audio?.label ?? "Pronunciation";
  const playLabel = `Play ${label.toLowerCase()} for ${writtenForm}`;
  return `<button class="lex-search-audio-button" type="button" aria-label="${escapeHtml(playLabel)}" title="${escapeHtml(label)}" aria-controls="${audioId}" data-lex-audio>
      <svg class="lex-search-audio-icon" aria-hidden="true" viewBox="0 0 24 24" focusable="false">
        <path d="M11 5 6.6 8.5H3.8a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h2.8L11 19a1 1 0 0 0 1.6-.8V5.8A1 1 0 0 0 11 5Z" />
        <path d="M16 8.5a5 5 0 0 1 0 7" />
        <path d="M18.7 5.8a9 9 0 0 1 0 12.4" />
      </svg>
    </button>
    <audio class="lex-search-audio" id="${audioId}" preload="metadata" aria-label="${escapeHtml(label)}">
      ${sources
        .map(
          (source) =>
            `<source src="${escapeHtml(source.url)}" type="${escapeHtml(source.type)}" />`,
        )
        .join("")}
    </audio>`;
}

function renderCopyLinkButton(href: string, writtenForm: string): string {
  const label = `Copy permalink for ${writtenForm}`;
  return `<button class="lex-search-copy-link-button" type="button" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}" data-lex-copy-link="${escapeHtml(href)}">
    <svg class="lex-search-link-icon" aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M10 13a5 5 0 0 0 7.54.54l2.83-2.83a5 5 0 0 0-7.07-7.07l-1.62 1.62" />
      <path d="M14 11a5 5 0 0 0-7.54-.54L3.63 13.3a5 5 0 0 0 7.07 7.07l1.62-1.62" />
    </svg>
  </button>`;
}

export function renderLexiconTagSuggestions(
  index: LexiconSearchIndex,
  query: string,
): string {
  const suggestions = listLexiconTagQuerySuggestions(index, query, { limit: 8 });
  return renderLexiconSuggestionList(suggestions, "Semantic field suggestions");
}

export function renderLexiconSearchSuggestions(
  index: LexiconSearchIndex,
  query: string,
): string {
  const suggestions = listLexiconQuerySuggestions(index, query, { limit: 8 });
  return renderLexiconSuggestionList(suggestions, "Search suggestions");
}

function renderLexiconSuggestionList(
  suggestions: readonly string[],
  label: string,
): string {
  if (!suggestions.length) return "";
  return `<span class="lex-search-suggestions" role="listbox" aria-label="${escapeHtml(label)}">${suggestions
    .map(
      (suggestion) =>
        `<button class="lex-search-suggestion" type="button" role="option" aria-selected="false" data-lex-suggestion="${escapeHtml(suggestion)}">${escapeHtml(suggestion)}</button>`,
    )
    .join("")}</span>`;
}

export function renderLexiconSearchResult(
  lexiconUrl: string,
  result: LexiconSearchResult,
): string {
  const entry = result.entry;
  const preview = summarizeLexiconSenses(entry);
  const tags = entry.fieldLabels.length ? entry.fieldLabels.join(", ") : "";
  const typeBadges = listLexiconTypeBadges(entry);
  const panelId = `lex-search-detail-${stableDomId(entry.id)}`;
  const audioId = `lex-search-audio-${stableDomId(entry.id)}`;
  const articleId = `lex-search-entry-${stableDomId(entry.id)}`;
  const entryHref = buildLexiconEntrySearchHref(lexiconUrl, entry);
  return `<article class="lex-search-result" id="${articleId}" data-lex-entry-id="${escapeHtml(entry.id)}">
    <div class="lex-search-row-wrap">
      <div class="lex-search-row">
        <span class="lex-search-summary-content">
          <span class="lex-search-summary-main">
            <span class="lex-search-word">${escapeHtml(entry.writtenForm)}</span>
            <span class="lex-search-pronunciation">
              <span class="lex-search-phonetic">/${escapeHtml(entry.phoneticForm)}/</span>
              ${renderAudioButton(entry.audio, audioId, entry.writtenForm)}
            </span>
            ${typeBadges.map((type) => `<span class="lex-search-type">${escapeHtml(type)}</span>`).join("")}
          </span>
          ${renderSenseLines(preview, "lex-search-preview")}
        </span>
        <span class="lex-search-row-actions">
          ${renderCopyLinkButton(entryHref, entry.writtenForm)}
          <button class="lex-search-disclosure-button" type="button" aria-expanded="false" aria-controls="${panelId}" data-lex-toggle>
            <span class="sr-only">Toggle entry details</span>
            <span class="lex-search-disclosure" aria-hidden="true"></span>
          </button>
        </span>
      </div>
    </div>
    <div class="lex-search-detail" id="${panelId}" hidden>
      ${renderDetailSenses(entry.senses)}
      ${tags ? `<p class="lex-search-tags">${escapeHtml(tags)}</p>` : ""}
      ${entry.protoform ? `<p>${escapeHtml(entry.protoform)}</p>` : ""}
      ${entry.note ? `<p>${escapeHtml(entry.note)}</p>` : ""}
    </div>
  </article>`;
}
