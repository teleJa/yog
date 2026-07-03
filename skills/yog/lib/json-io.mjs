import { writeSync } from 'node:fs';
import { ISSUE_ORDER } from './constants.mjs';

export function sortIssues(issues) {
  return [...issues].sort((left, right) => {
    const severityDelta = (ISSUE_ORDER.get(left.severity) ?? 99) - (ISSUE_ORDER.get(right.severity) ?? 99);
    if (severityDelta !== 0) return severityDelta;
    const leftPath = left.path ?? '';
    const rightPath = right.path ?? '';
    if (leftPath !== rightPath) return leftPath.localeCompare(rightPath);
    return String(left.message).localeCompare(String(right.message));
  });
}

export function writeJson(value) {
  const buffer = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  let offset = 0;
  const waitBuffer = new SharedArrayBuffer(4);
  const waitView = new Int32Array(waitBuffer);
  while (offset < buffer.length) {
    try {
      offset += writeSync(process.stdout.fd, buffer, offset, buffer.length - offset);
    } catch (error) {
      if (error?.code !== 'EAGAIN') throw error;
      Atomics.wait(waitView, 0, 0, 10);
    }
  }
}

export async function readStdinJson() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (raw.length === 0) return {};
  try {
    return JSON.parse(raw);
  } catch {
    writeJson({
      issues: [
        {
          severity: 'P1',
          message: 'stdin is not valid JSON.',
          details: { reason: 'parse-error' },
        },
      ],
    });
    process.exit(2);
  }
}

export function finishWithIssues(issues) {
  const sorted = sortIssues(issues);
  writeJson({ issues: sorted });
  process.exit(sorted.some((issue) => issue.severity === 'P0' || issue.severity === 'P1') ? 1 : 0);
}

export function finishOk(value = { issues: [] }) {
  writeJson(value);
  process.exit(0);
}
