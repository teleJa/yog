export function hasTemplatePlaceholder(markdown) {
  return /\{[^}\n]+\}/.test(markdown);
}

export function stripFrontmatter(markdown) {
  if (!markdown.startsWith('---\n')) return markdown;
  const end = markdown.indexOf('\n---\n', 4);
  return end === -1 ? markdown : markdown.slice(end + 5);
}

export function hasRealBodyContent(markdown) {
  const body = stripFrontmatter(markdown)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !hasTemplatePlaceholder(line));
  return body.length > 0;
}

export function normalizeGeneratedText(text) {
  return text
    .replace(/Generated at:\s*[0-9TZ:.-]+/g, 'Generated at:')
    .replace(/"generated_at":\s*"[^"]*"/g, '"generated_at": ""');
}
