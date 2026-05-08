function stripHtmlToText(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim();
}

export { stripHtmlToText };
