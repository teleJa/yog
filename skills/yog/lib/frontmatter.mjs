export function parseSimpleYamlValue(raw) {
  const value = String(raw).trim();
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === '[]') return [];
  if (value.startsWith('{') || value === '|' || value === '>') {
    throw new Error(`unsupported YAML value: ${value}`);
  }
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return value.replace(/^["']|["']$/g, '');
}

export function parseFrontmatter(markdown) {
  if (!markdown.startsWith('---\n')) return { data: {}, body: markdown };
  const end = markdown.indexOf('\n---\n', 4);
  if (end === -1) throw new Error('frontmatter closing marker not found');
  const raw = markdown.slice(4, end);
  const body = markdown.slice(end + 5);
  const data = {};
  const lines = raw.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    if (line.startsWith('  - ')) throw new Error(`list item without key: ${line}`);
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) throw new Error(`unsupported frontmatter line: ${line}`);
    const [, key, value] = match;
    if (value === '') {
      const items = [];
      while (lines[index + 1]?.startsWith('  - ')) {
        index += 1;
        items.push(lines[index].slice(4).trim());
      }
      data[key] = items;
    } else {
      data[key] = parseSimpleYamlValue(value);
    }
  }
  return { data, body };
}

export function stringifyFrontmatter(data) {
  const lines = ['---'];
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) lines.push(`${key}: [${value.join(', ')}]`);
    else lines.push(`${key}: ${value}`);
  }
  lines.push('---');
  return `${lines.join('\n')}\n`;
}

export function validateStatusForDocument(type, status) {
  if (type === 'candidate' && status === 'verified') return ['Candidate documents cannot use status verified.'];
  if (type !== 'adr' && status === 'accepted') return ['Status accepted is only valid for ADR documents.'];
  if (type === 'adr' && status !== 'accepted') return [`ADR status must be accepted, got ${status}.`];
  return [];
}
