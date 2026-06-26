// vault.ts — the notes vault. Note *content* lives as raw .md files here; the DB
// only shadows them. App-managed: dirs created on boot if missing. Overridable via
// VAULT_DIR (read lazily so tests can point at a temp dir before the first scan).
//
// Multi-tenant: each owner gets their OWN subdir (vault/<owner_id>/). All paths must
// go through abs(owner, …), which also asserts the resolved path stays inside that
// owner's root — defense-in-depth against a `..`/traversal path slipping through.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// the shared base dir holding every owner's vault subdir
export function vaultBase(): string {
  const dir = process.env.VAULT_DIR || path.join(__dirname, '..', 'data', 'vault');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// one owner's vault root
export function vaultRoot(owner: string): string {
  const dir = path.join(vaultBase(), owner);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// absolute path for an owner-relative note path, asserted to stay within the owner's root
export function abs(owner: string, relPath: string): string {
  const root = vaultRoot(owner);
  const p = path.resolve(root, relPath);
  if (p !== root && !p.startsWith(root + path.sep)) {
    throw new Error(`vault path escapes its root: ${relPath}`);
  }
  return p;
}
