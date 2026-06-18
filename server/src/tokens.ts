// tokens.ts — opaque, revocable API tokens (PATs) for CLI / MCP / agents /
// portfolio. The token is shown once; only its sha256 hash is stored. Resolves
// via `Authorization: Bearer <token>` to a (user, scopes) principal.

import crypto from 'node:crypto';
import type { ResolvedPrincipal } from './auth.js';
import type { DB } from './db.js';
import { newId } from './ids.js';

const SESSION_USER_COLS = [
  'id',
  'username',
  'email',
  'theme',
  'week_start',
  'sort_prefs',
  'fib_sizing',
  'is_admin',
] as const;

export const mintApiToken = (): string => `tdx_pat_${crypto.randomBytes(32).toString('base64url')}`;
export const hashApiToken = (t: string): string =>
  crypto.createHash('sha256').update(t).digest('hex');

export interface TokenInfo {
  id: string;
  name: string;
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export async function createToken(
  db: DB,
  userId: string,
  name: string,
  scopes: string[],
): Promise<{ id: string; token: string }> {
  const id = newId();
  const token = mintApiToken();
  await db
    .insertInto('api_tokens')
    .values({
      id,
      user_id: userId,
      name,
      token_hash: hashApiToken(token),
      scopes: JSON.stringify(scopes),
      created_at: new Date().toISOString(),
      last_used_at: null,
      revoked_at: null,
    })
    .execute();
  return { id, token };
}

export async function listTokens(db: DB, userId: string): Promise<TokenInfo[]> {
  const rows = await db
    .selectFrom('api_tokens')
    .select(['id', 'name', 'scopes', 'created_at', 'last_used_at', 'revoked_at'])
    .where('user_id', '=', userId)
    .orderBy('created_at')
    .execute();
  return rows.map((r) => ({ ...r, scopes: parseScopes(r.scopes) }));
}

export async function revokeToken(db: DB, userId: string, id: string): Promise<boolean> {
  const res = await db
    .updateTable('api_tokens')
    .set({ revoked_at: new Date().toISOString() })
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .where('revoked_at', 'is', null)
    .executeTakeFirst();
  return Number(res.numUpdatedRows) > 0;
}

// Resolve a raw bearer token to a principal (scopes from the token, full=false).
export async function resolveBearer(db: DB, raw: string): Promise<ResolvedPrincipal | null> {
  if (!raw) return null;
  const row = await db
    .selectFrom('api_tokens')
    .select(['id', 'user_id', 'scopes', 'revoked_at'])
    .where('token_hash', '=', hashApiToken(raw))
    .executeTakeFirst();
  if (!row || row.revoked_at) return null;
  const user = await db
    .selectFrom('users')
    .select(SESSION_USER_COLS)
    .where('id', '=', row.user_id)
    .executeTakeFirst();
  if (!user) return null;
  await db
    .updateTable('api_tokens')
    .set({ last_used_at: new Date().toISOString() })
    .where('id', '=', row.id)
    .execute();
  return { user, scopes: parseScopes(row.scopes), full: false };
}

function parseScopes(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}
