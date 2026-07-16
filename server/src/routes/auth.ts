// routes/auth.ts — login / logout / me / account. Faithful port of
// backend/src/routes/auth.js using Kysely + the ported auth module.

import { Type } from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';
import {
  COOKIE_NAME,
  type PublicUser,
  SESSION_TTL_MS,
  cleanSortPrefs,
  clearFailures,
  createSession,
  dummyVerify,
  hashPassword,
  publicUser,
  rateLimited,
  recordFailure,
  resolveSession,
  revokeSession,
  revokeUserSessions,
  validateEmail,
  validatePassword,
  validateUsername,
  verifyPassword,
} from '../auth.js';
import { slug } from '../query.js'; // the same name-matcher the query engine uses (n.16)
import { ErrorSchema, OkSchema, UserSchema } from '../schemas.js';

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'strict' as const,
  secure: false, // plain HTTP over LAN; revisit behind HTTPS
  path: '/',
  signed: true,
  maxAge: Math.floor(SESSION_TTL_MS / 1000),
};

const ALLOWED_THEMES = ['amber', 'matrix', 'ice', 'paper', 'plasma', 'magenta'];
const WEEK_STARTS = [0, 1, 2, 3, 4, 5, 6];

export default async function authRoutes(app: FastifyInstance): Promise<void> {
  // ---- login --------------------------------------------------------------
  app.post(
    '/api/auth/login',
    {
      schema: {
        summary: 'Log in',
        description:
          'Exchange a username + password for a session cookie (`tdx_session`). **Public** (the only ' +
          'unauthenticated write route); rate-limited. On success sets the cookie and returns the user.',
        tags: ['Auth'],
        security: [], // public
        body: Type.Object(
          { username: Type.Optional(Type.String()), password: Type.Optional(Type.String()) },
          { additionalProperties: true, examples: [{ username: 'alice', password: '••••••••' }] },
        ),
        response: { 200: UserSchema, 401: ErrorSchema, 429: ErrorSchema },
      },
    },
    async (request, reply) => {
      const { username, password } = (request.body ?? {}) as {
        username?: string;
        password?: string;
      };
      const ip = request.ip;
      const GENERIC = { error: 'invalid username or password' };

      if (rateLimited(username, ip)) {
        return reply.code(429).send({ error: 'too many attempts — try again shortly' });
      }
      if (!username || !password) {
        recordFailure(username, ip);
        return reply.code(401).send(GENERIC);
      }

      const user = await app.db
        .selectFrom('users')
        .selectAll()
        .where('username', '=', String(username).trim()) // column is COLLATE NOCASE
        .executeTakeFirst();
      if (!user) {
        await dummyVerify(String(password)); // equalize timing
        recordFailure(username, ip);
        return reply.code(401).send(GENERIC);
      }
      const ok = await verifyPassword(user.password_hash, String(password));
      if (!ok) {
        recordFailure(username, ip);
        return reply.code(401).send(GENERIC);
      }

      clearFailures(username, ip);
      const token = await createSession(app.db, user.id);
      reply.setCookie(COOKIE_NAME, token, COOKIE_OPTS);
      return publicUser(user);
    },
  );

  // ---- logout -------------------------------------------------------------
  app.post(
    '/api/auth/logout',
    {
      preHandler: app.authenticate,
      schema: {
        summary: 'Log out',
        description: 'Revoke the current session and clear the cookie.',
        tags: ['Auth'],
        response: { 200: OkSchema },
      },
    },
    async (request, reply) => {
      const raw = request.cookies[COOKIE_NAME];
      const unsigned = raw ? request.unsignCookie(raw) : null;
      if (unsigned?.valid && unsigned.value) await revokeSession(app.db, unsigned.value);
      reply.clearCookie(COOKIE_NAME, { path: '/' });
      return { ok: true };
    },
  );

  // ---- me -----------------------------------------------------------------
  app.get(
    '/api/auth/me',
    {
      preHandler: app.authenticate,
      schema: {
        summary: 'Current user',
        description: 'The authenticated user behind the current credential.',
        tags: ['Auth'],
        response: { 200: UserSchema, 401: ErrorSchema },
      },
    },
    async (request) => {
      return publicUser(request.user!);
    },
  );

  // ---- account update -----------------------------------------------------
  app.put(
    '/api/auth/account',
    {
      preHandler: app.authenticate,
      schema: {
        summary: 'Update account settings',
        description:
          'Update profile, preferences, and/or credentials — every field is optional; only those ' +
          'present are changed. Changing the password requires `oldPassword` and revokes all *other* ' +
          'sessions. Field-specific validation errors return 400 with a `field`; username/email ' +
          'collisions return 409.',
        tags: ['Auth'],
        body: Type.Object(
          {
            username: Type.Optional(Type.String()),
            email: Type.Optional(Type.String()),
            oldPassword: Type.Optional(Type.String()),
            newPassword: Type.Optional(Type.String()),
            theme: Type.Optional(Type.String()),
            week_start: Type.Optional(Type.Integer()),
            sort_prefs: Type.Optional(Type.Unknown()),
            fib_sizing: Type.Optional(Type.Union([Type.Boolean(), Type.Integer()])),
            notes_root_name: Type.Optional(Type.String()),
            calendars_all_name: Type.Optional(Type.String()),
          },
          { additionalProperties: true },
        ),
        response: { 200: UserSchema, 400: ErrorSchema, 401: ErrorSchema, 409: ErrorSchema },
      },
    },
    async (request, reply) => {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const userId = request.user!.id;
      const current = await app.db
        .selectFrom('users')
        .selectAll()
        .where('id', '=', userId)
        .executeTakeFirst();
      if (!current) return reply.code(401).send({ error: 'unauthorized' });

      let username = current.username;
      let email = current.email;
      let passwordHash = current.password_hash;
      let theme = current.theme || 'amber';
      let weekStart = current.week_start ?? 1;
      let sortPrefs = current.sort_prefs ?? null; // JSON string or null
      let fibSizing = current.fib_sizing ?? 0;
      let rootName = current.notes_root_name ?? 'Inbox'; // '' = the base directory is hidden (n.16)
      let allCalName = current.calendars_all_name ?? 'Everything'; // '' = the row is hidden (e.10)

      if (body.theme !== undefined) {
        if (!ALLOWED_THEMES.includes(body.theme as string))
          return reply.code(400).send({ error: 'unknown theme', field: 'theme' });
        theme = body.theme as string;
      }
      if (body.sort_prefs !== undefined) {
        const clean = cleanSortPrefs(body.sort_prefs);
        if (clean === undefined)
          return reply.code(400).send({ error: 'invalid sort prefs', field: 'sort_prefs' });
        sortPrefs = clean === null ? null : JSON.stringify(clean);
      }
      if (body.week_start !== undefined) {
        if (!WEEK_STARTS.includes(Number(body.week_start)))
          return reply.code(400).send({ error: 'invalid week start', field: 'week_start' });
        weekStart = Number(body.week_start);
      }
      if (body.fib_sizing !== undefined) {
        const v = Number(body.fib_sizing);
        if (![0, 1].includes(v))
          return reply.code(400).send({ error: 'invalid fib_sizing', field: 'fib_sizing' });
        fibSizing = v;
      }
      // the vault's base directory name (n.16). '' is VALID — it hides the row, which is exactly
      // how notes behaved before the feature. A name that collides with a real folder is not: the
      // query language matches folders by NAME, at any depth, so `folder:x` would be ambiguous.
      if (body.notes_root_name !== undefined) {
        const v = String(body.notes_root_name ?? '').trim();
        if (v.length > 60)
          return reply.code(400).send({ error: 'name too long', field: 'notes_root_name' });
        if (v) {
          const folders = await app.db
            .selectFrom('folders')
            .select('name')
            .where('owner_id', '=', userId)
            .where('archived', '=', 0)
            .execute();
          if (folders.some((f) => slug(f.name) === slug(v)))
            return reply
              .code(400)
              .send({ error: 'a folder is already called that', field: 'notes_root_name' });
        }
        rootName = v;
      }
      // the "all calendars" nav row's name (e.10). '' is VALID — it hides the row, which is exactly
      // how the events app behaved before the feature. Unlike the base directory this name is NOT
      // query-addressable (the row means "no calendar filter", not "events with no calendar"), so
      // the collision check is about the NAV, not the query language: two rows in the same section
      // reading the same word is just confusing.
      if (body.calendars_all_name !== undefined) {
        const v = String(body.calendars_all_name ?? '').trim();
        if (v.length > 60)
          return reply.code(400).send({ error: 'name too long', field: 'calendars_all_name' });
        if (v) {
          const calendars = await app.db
            .selectFrom('calendars')
            .select('name')
            .where('owner_id', '=', userId)
            .where('archived', '=', 0)
            .execute();
          if (calendars.some((c) => slug(c.name) === slug(v)))
            return reply
              .code(400)
              .send({ error: 'a calendar is already called that', field: 'calendars_all_name' });
        }
        allCalName = v;
      }
      if (body.username !== undefined) {
        const v = validateUsername(body.username);
        if (!v.ok) return reply.code(400).send({ error: v.error, field: 'username' });
        const clash = await app.db
          .selectFrom('users')
          .select('id')
          .where('username', '=', v.value)
          .where('id', '!=', userId)
          .executeTakeFirst();
        if (clash)
          return reply.code(409).send({ error: 'username is already taken', field: 'username' });
        username = v.value;
      }
      if (body.email !== undefined) {
        const v = validateEmail(body.email);
        if (!v.ok) return reply.code(400).send({ error: v.error, field: 'email' });
        const clash = await app.db
          .selectFrom('users')
          .select('id')
          .where('email', '=', v.value)
          .where('id', '!=', userId)
          .executeTakeFirst();
        if (clash)
          return reply.code(409).send({ error: 'email is already in use', field: 'email' });
        email = v.value;
      }

      let passwordChanged = false;
      if (body.newPassword !== undefined || body.oldPassword !== undefined) {
        const okOld = await verifyPassword(current.password_hash, String(body.oldPassword || ''));
        if (!okOld)
          return reply
            .code(400)
            .send({ error: 'current password is incorrect', field: 'oldPassword' });
        const v = validatePassword(body.newPassword);
        if (!v.ok) return reply.code(400).send({ error: v.error, field: 'newPassword' });
        if (await verifyPassword(current.password_hash, v.value)) {
          return reply
            .code(400)
            .send({ error: 'new password must differ from the current one', field: 'newPassword' });
        }
        passwordHash = await hashPassword(v.value);
        passwordChanged = true;
      }

      const now = new Date().toISOString();
      try {
        await app.db
          .updateTable('users')
          .set({
            username,
            email,
            password_hash: passwordHash,
            theme,
            week_start: weekStart,
            sort_prefs: sortPrefs,
            fib_sizing: fibSizing,
            notes_root_name: rootName,
            calendars_all_name: allCalName,
            updated_at: now,
          })
          .where('id', '=', userId)
          .execute();
      } catch (err) {
        if (/UNIQUE/.test((err as Error).message))
          return reply.code(409).send({ error: 'username or email already in use' });
        throw err;
      }

      if (passwordChanged) {
        const raw = request.cookies[COOKIE_NAME];
        const unsigned = raw ? request.unsignCookie(raw) : null;
        await revokeUserSessions(app.db, userId, unsigned?.valid ? unsigned.value : null);
      }

      // NOTE this response is hand-built — the row is NOT re-read. A field persisted above but
      // omitted here updates the DB while the client keeps showing the old value.
      const result: PublicUser = publicUser({
        id: userId,
        username,
        email,
        theme,
        week_start: weekStart,
        sort_prefs: sortPrefs,
        fib_sizing: fibSizing,
        notes_root_name: rootName,
        calendars_all_name: allCalName,
        is_admin: current.is_admin,
      });
      return result;
    },
  );
}

// Re-export for the test helper.
export { resolveSession };
