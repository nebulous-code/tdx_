// auth.ts — TypeScript port of backend/src/auth.js: argon2 hashing, DB-backed
// sessions, validators, in-memory login rate-limiting, and the publicUser shape.
// The legacy module closed over a `db` global; here every DB-touching function
// takes the Kysely handle explicitly. Constants/encodings are unchanged so
// existing cookies stay valid across cutover.

import crypto from 'node:crypto';
import { Algorithm, hash, verify } from '@node-rs/argon2';
import type { DB } from './db.js';

// ---- password hashing (argon2id, OWASP-aligned) ----------------------------
const ARGON_OPTS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};
export const hashPassword = (plain: string): Promise<string> => hash(plain, ARGON_OPTS);
export const verifyPassword = (hashed: string, plain: string): Promise<boolean> =>
  verify(hashed, plain).catch(() => false);

// A throwaway hash so login can run a verify even for an unknown username,
// keeping response time roughly constant (no user-enumeration timing leak).
let _dummyHash: string | null = null;
export async function dummyVerify(plain: string): Promise<void> {
  if (!_dummyHash) _dummyHash = await hashPassword('timing-equalizer');
  await verifyPassword(_dummyHash, plain);
}

// ---- session tokens --------------------------------------------------------
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, sliding
export const COOKIE_NAME = 'tdx_session';

const mintToken = (): string => crypto.randomBytes(32).toString('base64url'); // -> cookie
const hashToken = (t: string): string => crypto.createHash('sha256').update(t).digest('hex'); // -> sessions.id

// The user row the session resolves to (raw DB shape: 0/1 ints, JSON string).
export interface SessionUser {
  id: string;
  username: string;
  email: string;
  theme: string | null;
  week_start: number;
  sort_prefs: string | null;
  fib_sizing: number;
  is_admin: number;
}

export async function createSession(db: DB, userId: string): Promise<string> {
  const token = mintToken();
  const now = new Date();
  await db
    .insertInto('sessions')
    .values({
      id: hashToken(token),
      user_id: userId,
      created_at: now.toISOString(),
      expires_at: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
      last_seen: now.toISOString(),
    })
    .execute();
  return token; // raw token goes in the cookie; only its hash is stored
}

// Resolve a raw token to its user, sliding the expiry forward. Deletes the
// session if expired. Returns the user row or null.
export async function resolveSession(db: DB, rawToken: string): Promise<SessionUser | null> {
  if (!rawToken) return null;
  const sid = hashToken(rawToken);
  const sess = await db
    .selectFrom('sessions')
    .select(['user_id', 'expires_at'])
    .where('id', '=', sid)
    .executeTakeFirst();
  if (!sess) return null;
  const now = new Date();
  if (new Date(sess.expires_at) <= now) {
    await db.deleteFrom('sessions').where('id', '=', sid).execute();
    return null;
  }
  await db
    .updateTable('sessions')
    .set({
      expires_at: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
      last_seen: now.toISOString(),
    })
    .where('id', '=', sid)
    .execute();
  const user = await db
    .selectFrom('users')
    .select([
      'id',
      'username',
      'email',
      'theme',
      'week_start',
      'sort_prefs',
      'fib_sizing',
      'is_admin',
    ])
    .where('id', '=', sess.user_id)
    .executeTakeFirst();
  return user ?? null;
}

export async function revokeSession(db: DB, rawToken: string): Promise<void> {
  await db.deleteFrom('sessions').where('id', '=', hashToken(rawToken)).execute();
}

// Revoke every session for a user except an optional one to keep (the current).
export async function revokeUserSessions(
  db: DB,
  userId: string,
  keepRawToken?: string | null,
): Promise<void> {
  let q = db.deleteFrom('sessions').where('user_id', '=', userId);
  if (keepRawToken) q = q.where('id', '!=', hashToken(keepRawToken));
  await q.execute();
}

// ---- validators ------------------------------------------------------------
export type ValidationResult = { ok: true; value: string } | { ok: false; error: string };

export function validateUsername(raw: unknown): ValidationResult {
  const value = String(raw ?? '').trim();
  if (value.length < 1 || value.length > 32)
    return { ok: false, error: 'username must be 1–32 characters' };
  return { ok: true, value };
}
export function validateEmail(raw: unknown): ValidationResult {
  const value = String(raw ?? '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
    return { ok: false, error: 'enter a valid email address' };
  return { ok: true, value };
}
export function validatePassword(raw: unknown): ValidationResult {
  const value = String(raw ?? '');
  if (value.length < 8) return { ok: false, error: 'password must be at least 8 characters' };
  if (!/[A-Z]/.test(value)) return { ok: false, error: 'password needs an uppercase letter' };
  if (!/[a-z]/.test(value)) return { ok: false, error: 'password needs a lowercase letter' };
  if (!/[0-9]/.test(value)) return { ok: false, error: 'password needs a number' };
  if (!/[^A-Za-z0-9]/.test(value)) return { ok: false, error: 'password needs a symbol' };
  return { ok: true, value };
}

// validate + normalize a client sort_prefs object → clean {order,enabled,dirs}
// (or null). Returns undefined if the payload is malformed.
const SORT_KEYS = ['due', 'created', 'title', 'project', 'priority', 'tag'];
export interface SortPrefs {
  order: string[];
  enabled: Record<string, boolean>;
  dirs: Record<string, 'asc' | 'desc'>;
}
export function cleanSortPrefs(p: unknown): SortPrefs | null | undefined {
  if (p === null) return null;
  if (typeof p !== 'object' || Array.isArray(p)) return undefined;
  const o = p as {
    order?: unknown;
    enabled?: Record<string, unknown>;
    dirs?: Record<string, unknown>;
  };
  const order = Array.isArray(o.order) ? o.order.filter((k) => SORT_KEYS.includes(k)) : [];
  for (const k of SORT_KEYS) if (!order.includes(k)) order.push(k);
  const enabled: Record<string, boolean> = {};
  const dirs: Record<string, 'asc' | 'desc'> = {};
  for (const k of SORT_KEYS) {
    enabled[k] = !(o.enabled && o.enabled[k] === false);
    dirs[k] = o.dirs && o.dirs[k] === 'desc' ? 'desc' : 'asc';
  }
  if (!SORT_KEYS.some((k) => enabled[k])) return undefined;
  return { order, enabled, dirs };
}

export interface PublicUser {
  id: string;
  username: string;
  email: string;
  theme: string;
  week_start: number;
  sort_prefs: SortPrefs | null;
  fib_sizing: boolean;
  is_admin: boolean;
}
export function publicUser(u: SessionUser): PublicUser {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    theme: u.theme || 'amber',
    week_start: u.week_start ?? 1,
    sort_prefs: u.sort_prefs ? (JSON.parse(u.sort_prefs) as SortPrefs) : null,
    fib_sizing: !!u.fib_sizing,
    is_admin: !!u.is_admin,
  };
}

// ---- principals & scopes (sessions are full-scope; PATs carry scopes) ------
export interface ResolvedPrincipal {
  user: SessionUser;
  scopes: string[];
  full: boolean; // a session: implies every scope
}
// Only the read/write suffix is enforced now; per-domain prefixes are reserved.
// Accepts '*', a bare 'read'/'write', or a domain-scoped 'tasks:read'.
export function hasScope(p: ResolvedPrincipal, action: 'read' | 'write'): boolean {
  return p.full || p.scopes.some((s) => s === '*' || s === action || s.endsWith(`:${action}`));
}

// ---- login rate-limiting (in-memory; resets on restart) --------------------
const MAX_FAILS = 5;
const WINDOW_MS = 15 * 60 * 1000;
const BLOCK_MS = 60 * 1000;
interface Attempt {
  windowStart: number;
  fails: number;
  blockedUntil: number;
}
const attempts = new Map<string, Attempt>();
const rlKey = (username: unknown, ip: string): string =>
  `${String(username || '').toLowerCase()}|${ip}`;

export function rateLimited(username: unknown, ip: string): boolean {
  const rec = attempts.get(rlKey(username, ip));
  return !!(rec && rec.blockedUntil && rec.blockedUntil > Date.now());
}
export function recordFailure(username: unknown, ip: string): void {
  const key = rlKey(username, ip);
  const now = Date.now();
  let rec = attempts.get(key);
  if (!rec || now - rec.windowStart > WINDOW_MS)
    rec = { windowStart: now, fails: 0, blockedUntil: 0 };
  rec.fails += 1;
  if (rec.fails >= MAX_FAILS) rec.blockedUntil = now + BLOCK_MS;
  attempts.set(key, rec);
}
export const clearFailures = (username: unknown, ip: string): boolean =>
  attempts.delete(rlKey(username, ip));
