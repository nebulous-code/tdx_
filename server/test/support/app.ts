// Test helper: build an app on a fresh in-memory DB, and create+login a user,
// replaying the login-issued SIGNED cookie (never hand-signing).

process.env.SESSION_SECRET ||= 'test-secret-please-change';

import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { type DB, type Sqlite, openDatabase } from '../../src/db.js';
import { type NewUserInput, createUser } from '../../src/seed.js';

export interface TestApp {
  app: FastifyInstance;
  db: DB;
  sqlite: Sqlite;
}

export async function buildTestApp(): Promise<TestApp> {
  const { sqlite, db } = openDatabase(':memory:');
  const app = await buildApp({ sqlite, db, logger: false });
  await app.ready();
  return { app, db, sqlite };
}

export const TEST_CREDS: NewUserInput = {
  username: 'alice',
  email: 'alice@example.com',
  password: 'Sup3r!secret',
};

export interface LoggedIn {
  user: { id: string; username: string; email: string; is_admin: number };
  cookie: string; // 'tdx_session=<signed>'
}

export async function createAndLogin(
  app: FastifyInstance,
  db: DB,
  creds: NewUserInput = TEST_CREDS,
  opts: { isAdmin?: boolean } = { isAdmin: true },
): Promise<LoggedIn> {
  const user = await createUser(db, creds, opts);
  const cookie = await login(app, creds.username, creds.password);
  return { user, cookie };
}

export async function login(
  app: FastifyInstance,
  username: string,
  password: string,
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username, password },
  });
  if (res.statusCode !== 200) throw new Error(`login failed (${res.statusCode}): ${res.body}`);
  const c = res.cookies.find((x) => x.name === 'tdx_session');
  if (!c) throw new Error('no session cookie set on login');
  return `${c.name}=${c.value}`;
}
