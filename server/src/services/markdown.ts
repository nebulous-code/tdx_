// markdown.ts — hand-rolled (zero-dep) note parsing for the vault scanner (D2 §4).
// Notes are ordinary markdown with a YAML-subset frontmatter block carrying a
// machine-managed `id:`. The note's TITLE is its filename (Obsidian model), not a
// frontmatter key — so the only managed metadata is the id; every other frontmatter
// key the user wrote is preserved verbatim. We parse the id, the rest of the
// frontmatter, the body, and the [[wikilinks]] the scanner materializes into links.

export interface ParsedNote {
  id: string | null;
  frontmatter: Record<string, string>; // every key except the managed `id`, preserved
  body: string;
}

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?/;

function unquote(v: string): string {
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

export function parseNote(raw: string): ParsedNote {
  let body = raw;
  const fm: Record<string, string> = {};
  const m = raw.match(FRONTMATTER);
  if (m) {
    body = raw.slice(m[0].length).replace(/^\n/, ''); // drop the one separator blank line
    for (const line of m[1].split('\n')) {
      const i = line.indexOf(':');
      if (i === -1) continue;
      const key = line.slice(0, i).trim();
      if (key) fm[key] = unquote(line.slice(i + 1).trim());
    }
  }
  const id = fm.id || null;
  const frontmatter: Record<string, string> = {};
  for (const [k, v] of Object.entries(fm)) if (k !== 'id') frontmatter[k] = v; // keep all but id
  return { id, frontmatter, body };
}

// quote a frontmatter scalar only when it could be misread (colon, leading quote/#)
function fmScalar(v: string): string {
  return /[:#"']|^\s|\s$/.test(v) ? `"${v.replace(/"/g, '\\"')}"` : v;
}

// Build a full note file (used for app-created/edited notes, where we own the file).
// Title is the filename, so the frontmatter is just the managed id + any extra keys.
export function serializeNote(opts: {
  id: string;
  body: string;
  frontmatter?: Record<string, string>;
}): string {
  const lines = ['---', `id: ${opts.id}`];
  for (const [k, v] of Object.entries(opts.frontmatter ?? {})) lines.push(`${k}: ${fmScalar(v)}`);
  lines.push('---', '');
  return `${lines.join('\n')}\n${opts.body.replace(/^\n+/, '')}`;
}

// Surgically inject a machine id into an externally-authored file (preserves the
// rest of the frontmatter/body byte-for-byte) — the gentle "writeback" on scan.
export function injectFrontmatterId(raw: string, id: string): string {
  if (FRONTMATTER.test(raw)) return raw.replace(/^---\n/, `---\nid: ${id}\n`);
  return `---\nid: ${id}\n---\n\n${raw}`;
}

export interface ExtractedLinks {
  tasks: string[];
  events: string[];
  notes: string[]; // note-name targets (resolved to ids during reconcile)
}

export function extractLinks(body: string): ExtractedLinks {
  // Construct locally so the stateful `/g` `lastIndex` can never leak between calls.
  const typed = /\[\[(task|event):([\w-]+)(?:\|[^\]\n]*)?\]\]/g; // optional |display alias
  const wiki = /\[\[([^\]]+)\]\]/g;
  const tasks = new Set<string>();
  const events = new Set<string>();
  const notes = new Set<string>();
  for (let m = typed.exec(body); m; m = typed.exec(body)) {
    (m[1] === 'task' ? tasks : events).add(m[2]);
  }
  for (let m = wiki.exec(body); m; m = wiki.exec(body)) {
    const inner = m[1].trim();
    if (/^(task|event):/.test(inner)) continue; // handled above as a typed link
    const name = inner.split('|')[0].split('#')[0].trim(); // strip [[Name|alias]] / [[Name#heading]]
    if (name) notes.add(name);
  }
  return { tasks: [...tasks], events: [...events], notes: [...notes] };
}
