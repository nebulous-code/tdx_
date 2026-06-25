// vault.ts — the single notes vault root (D2 §4). Note *content* lives as raw
// .md files here; the DB only shadows them. App-managed: created on boot if
// missing. Overridable via VAULT_DIR (read lazily so tests can point at a temp
// dir before the first scan). Single vault root for D2.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function vaultRoot(): string {
  const dir = process.env.VAULT_DIR || path.join(__dirname, '..', 'data', 'vault');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export const abs = (relPath: string): string => path.join(vaultRoot(), relPath);
export const rel = (absPath: string): string => path.relative(vaultRoot(), absPath);
