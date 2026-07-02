export function hasTemplatePlaceholder(markdown) {
  return markdown.split('\n').some((rawLine) => {
    const line = rawLine.trim();
    if (!line) return false;
    const markerless = line
      .replace(/^#+\s+/, '')
      .replace(/^(?:[-*]\s+|\d+[.)]\s+)/, '')
      .trim();
    return /^`?\{[^}\n]+\}`?[,.，。:：;；]?$/.test(markerless);
  });
}

export function stripFrontmatter(markdown) {
  if (!markdown.startsWith('---\n')) return markdown;
  const end = markdown.indexOf('\n---\n', 4);
  return end === -1 ? markdown : markdown.slice(end + 5);
}

const PLACEHOLDER_TEXT_PATTERN = /^(?:[-*]\s+|\d+[.)]\s+)?(?:TODO|TBD|待补充|待确认)$/i;
const OPEN_QUESTIONS_HEADINGS = new Set(['未确认问题', 'Open Questions']);

function headingText(line) {
  const match = line.match(/^#+\s+(.+)$/);
  return match ? match[1].trim() : null;
}

function isAllowedPlaceholderSection(heading) {
  return OPEN_QUESTIONS_HEADINGS.has(heading);
}

export function hasRealBodyContent(markdown) {
  let currentHeading = '';
  for (const rawLine of stripFrontmatter(markdown).split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const heading = headingText(line);
    if (heading) {
      currentHeading = heading;
      continue;
    }
    if (hasTemplatePlaceholder(line)) continue;
    if (PLACEHOLDER_TEXT_PATTERN.test(line) && !isAllowedPlaceholderSection(currentHeading)) continue;
    return true;
  }
  return false;
}

export function normalizeGeneratedText(text) {
  return text
    .replace(/Generated at:\s*[0-9TZ:.-]+/g, 'Generated at:')
    .replace(/"generated_at":\s*"[^"]*"/g, '"generated_at": ""');
}
