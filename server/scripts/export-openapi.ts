// scripts/export-openapi.ts — regenerate the static API docs a design agent consumes:
//   docs/openapi.json — the complete, machine-readable OpenAPI contract (the primary hand-off)
//   docs/API.md       — a readable digest grouped by tag
// Run: `npm run export:openapi` (from server/). Uses an in-memory DB so it has no side effects.

import fs from 'node:fs';
import path from 'node:path';

process.env.SESSION_SECRET ||= 'export-openapi';

const { openDatabase } = await import('../src/db.js');
const { buildApp } = await import('../src/app.js');

const DOCS = path.resolve(process.cwd(), '..', 'docs');

type Spec = any;

export function toMarkdown(spec: Spec): string {
  const out: string[] = [
    `# ${spec.info.title} v${spec.info.version}`,
    '',
    '> Generated from the live OpenAPI spec (`docs/openapi.json`). Do not hand-edit — run `npm run export:openapi`.',
    '',
    spec.info.description || '',
    '',
  ];
  const byTag: Record<string, { method: string; path: string; op: Spec }[]> = {};
  for (const [p, methods] of Object.entries(spec.paths as Record<string, Spec>)) {
    for (const [m, op] of Object.entries(methods as Record<string, Spec>)) {
      if (!['get', 'post', 'put', 'delete', 'patch'].includes(m)) continue;
      const tag = (op.tags && op.tags[0]) || 'Other';
      (byTag[tag] ||= []).push({ method: m.toUpperCase(), path: p, op });
    }
  }
  for (const tag of Object.keys(byTag).sort()) {
    out.push(`## ${tag}`, '');
    for (const r of byTag[tag].sort((a, b) => a.path.localeCompare(b.path))) {
      out.push(`### \`${r.method} ${r.path}\`${r.op.summary ? ` — ${r.op.summary}` : ''}`, '');
      if (r.op.description) out.push(r.op.description, '');
      const codes = Object.keys(r.op.responses || {}).sort();
      out.push(`Responses: ${codes.length ? codes.join(', ') : '—'}`, '');
    }
  }
  return `${out.join('\n').trimEnd()}\n`;
}

// buildSpec is exported so the test can regenerate + compare without duplicating boot logic.
export async function buildSpec(): Promise<Spec> {
  const { sqlite, db } = openDatabase(':memory:');
  const app = await buildApp({ db, sqlite, logger: false, serveFrontend: false });
  await app.ready();
  const spec = app.swagger();
  await app.close();
  sqlite.close();
  return spec;
}

// run only when invoked directly (not when imported by the test)
if (import.meta.url === `file://${process.argv[1]}`) {
  const spec = await buildSpec();
  fs.mkdirSync(DOCS, { recursive: true });
  fs.writeFileSync(path.join(DOCS, 'openapi.json'), `${JSON.stringify(spec, null, 2)}\n`);
  fs.writeFileSync(path.join(DOCS, 'API.md'), toMarkdown(spec));
  const ops = Object.values(spec.paths as Record<string, object>).reduce(
    (n, m) => n + Object.keys(m).length,
    0,
  );
  console.log(
    `wrote docs/openapi.json + docs/API.md (${Object.keys(spec.paths).length} paths, ~${ops} operations)`,
  );
  process.exit(0);
}
