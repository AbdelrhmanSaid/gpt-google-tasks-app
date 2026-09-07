import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';

import { getMigrations } from 'better-auth/db/migration';
import { makeSignature, symmetricEncrypt } from 'better-auth/crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { createApp } from '../dist/app.js';
import {
  createGoogleAuth,
  tasksScope,
  previewOrigin,
} from '../dist/auth/google.js';
import { GoogleTasksClient } from '../dist/google/tasks.js';
import { readGoogleConfig } from '../dist/config.js';

const config = {
  baseURL: 'http://127.0.0.1:3001',
  secret: 'isolated-test-secret-never-used-for-live-users',
  clientId: 'test.apps.googleusercontent.com',
  clientSecret: 'test-only',
  allowedEmails: new Set(['one@example.com', 'two@example.com']),
  databasePath: ':memory:',
};

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('Google API pagination, field mapping, conditional writes, and safe failures', async () => {
  const calls = [];
  let taskStatus = 'needsAction';
  let failStatus = 200;
  const task = {
    id: 'task',
    title: 'Find ME',
    etag: '"version-1"',
    status: taskStatus,
    due: '2026-09-07T00:00:00.000Z',
  };
  const client = new GoogleTasksClient(
    async () => 'test-token',
    async (url, init) => {
      calls.push({ url: new URL(url), init });
      assert.equal(init.headers.get('Authorization'), 'Bearer test-token');

      if (url.includes('/users/@me/lists/list')) {
        return json({ id: 'list', title: 'Personal' });
      }

      if (failStatus !== 200) {
        return json({ privateError: 'must-not-escape' }, failStatus);
      }

      if (init.method === 'PATCH') {
        const body = JSON.parse(init.body);
        taskStatus = body.status ?? taskStatus;

        return json({ ...task, status: taskStatus, etag: '"version-2"' });
      }

      if (init.method === 'POST') {
        return json(task);
      }

      return json({ items: [task], nextPageToken: 'another-page' });
    },
  );

  const result = await client.search(
    'list',
    'find me',
    undefined,
    'first-page',
  );
  assert.equal(result.tasks[0].scheduledDate, '2026-09-07');
  assert.equal(result.nextPageToken, 'another-page');
  assert.equal(calls.at(-1).url.searchParams.get('pageToken'), 'first-page');
  assert.equal(calls.at(-1).url.searchParams.get('showHidden'), 'true');
  assert.equal(
    (await client.search('list', 'absent')).nextPageToken,
    'another-page',
  );

  await client.update({ id: 'task', listId: 'list' }, '"version-1"', {
    notes: null,
    scheduledDate: null,
  });
  assert.equal(calls.at(-1).init.headers.get('If-Match'), '"version-1"');
  assert.deepEqual(JSON.parse(calls.at(-1).init.body), {
    notes: null,
    due: null,
  });

  await client.create('list', 'New task', { scheduledDate: '2026-09-08' });
  assert.deepEqual(JSON.parse(calls.at(-1).init.body), {
    title: 'New task',
    due: '2026-09-08T00:00:00.000Z',
  });

  assert.equal(
    (
      await client.setCompleted(
        { id: 'task', listId: 'list' },
        '"version-1"',
        true,
      )
    ).tasks[0].status,
    'completed',
  );
  await client.setCompleted(
    { id: 'task', listId: 'list' },
    '"version-2"',
    false,
  );
  assert.deepEqual(JSON.parse(calls.at(-1).init.body), {
    status: 'needsAction',
    completed: null,
  });

  for (const [status, code] of [
    [401, 'reconnect'],
    [403, 'reconnect'],
    [404, 'not_found'],
    [412, 'conflict'],
    [500, 'unavailable'],
  ]) {
    failStatus = status;
    const before = calls.length;
    await assert.rejects(
      client.update({ id: 'task', listId: 'list' }, '"version-1"', {
        title: 'Change',
      }),
      (error) =>
        error.code === code && !error.message.includes('must-not-escape'),
    );
    assert.equal(
      calls.length - before,
      2,
      'one list lookup and one write; no automatic retry',
    );
  }
});

test('Real session validation, pilot admission, token encryption, and per-user MCP isolation', async () => {
  const google = createGoogleAuth(config);
  await (await getMigrations(google.auth.options)).runMigrations();
  const context = await google.auth.$context;
  const users = [];

  await assert.rejects(
    context.internalAdapter.createUser({
      name: 'Denied',
      email: 'denied@example.com',
      emailVerified: true,
    }),
  );
  await assert.rejects(
    context.internalAdapter.createUser({
      name: 'Unverified',
      email: 'one@example.com',
      emailVerified: false,
    }),
  );

  for (const email of config.allowedEmails) {
    const user = await context.internalAdapter.createUser({
      name: 'Test user',
      email,
      emailVerified: true,
    });
    const session = await context.internalAdapter.createSession(user.id);
    const encryptedToken = await symmetricEncrypt({
      key: config.secret,
      data: `token-${user.id}`,
    });

    await context.internalAdapter.createAccount({
      userId: user.id,
      providerId: 'google',
      accountId: `google-${user.id}`,
      scope: tasksScope,
      accessToken: encryptedToken,
      accessTokenExpiresAt: new Date(Date.now() + 3600000),
      refreshToken: await symmetricEncrypt({
        key: config.secret,
        data: 'test-refresh-token',
      }),
    });

    const signature = await makeSignature(session.token, config.secret);
    const cookie = `${context.authCookies.sessionToken.name}=${encodeURIComponent(`${session.token}.${signature}`)}`;
    assert.equal((await google.getUser({ cookie })).id, user.id);
    assert.notEqual(encryptedToken, `token-${user.id}`);
    users.push({ ...user, cookie });
  }

  assert.equal(
    await google.getUser({ cookie: 'better-auth.session_token=forged' }),
    null,
  );

  const originalFetch = globalThis.fetch;
  const services = new Map();

  try {
    // Replace only the Google network boundary; real auth still resolves/decrypts each account.
    globalThis.fetch = async (url, init) => {
      const owner = users.find(
        (user) =>
          init.headers.get('Authorization') === `Bearer token-${user.id}`,
      );
      assert.ok(
        owner,
        'provider token must belong to an authenticated test user',
      );

      if (url.includes('/users/@me/lists?')) {
        return json({ items: [{ id: owner.id, title: 'Private list' }] });
      }

      if (!url.includes(`/${owner.id}`)) {
        return json({}, 404);
      }

      if (url.includes('/users/@me/lists/')) {
        return json({ id: owner.id, title: 'Private list' });
      }

      return json({
        id: 'private-task',
        title: 'Private task',
        status: 'needsAction',
        etag: '"1"',
      });
    };

    for (const user of users) {
      services.set(user.id, google.tasksForUser(user.id));
    }
  } finally {
    globalThis.fetch = originalFetch;
  }

  const app = createApp({ ...google, tasksForUser: (id) => services.get(id) });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const clients = [];

  try {
    for (const path of [
      '/api/auth/get-access-token',
      '/api/auth/refresh-token',
      '/api/auth/list-accounts',
    ]) {
      assert.equal(
        (
          await fetch(`${origin}${path}`, {
            method: 'POST',
            headers: { cookie: users[0].cookie },
          })
        ).status,
        404,
      );
    }

    assert.equal(
      (
        await fetch(`${origin}/mcp`, {
          method: 'POST',
          headers: { cookie: users[0].cookie },
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await fetch(`${origin}/api/google/mcp`, {
          method: 'POST',
          headers: { Origin: previewOrigin },
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await fetch(`${origin}/api/google/mcp`, {
          method: 'POST',
          headers: {
            cookie: users[0].cookie,
            Origin: 'https://untrusted.example',
          },
        })
      ).status,
      403,
    );

    for (const user of users) {
      const client = new Client({ name: 'isolation-test', version: '1' });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`${origin}/api/google/mcp`), {
          requestInit: {
            headers: { Cookie: user.cookie, Origin: previewOrigin },
          },
        }),
      );
      clients.push(client);
      const result = await client.callTool({
        name: 'list_task_lists',
        arguments: {},
      });
      assert.equal(result.structuredContent.lists[0].id, user.id);
      assert.ok(!JSON.stringify(result).includes(`token-${user.id}`));
    }

    const foreign = { id: 'private-task', listId: users[1].id };

    for (const name of [
      'get_tasks',
      'render_tasks',
      'update_task',
      'set_task_completed',
    ]) {
      const args = name.endsWith('_tasks')
        ? { tasks: [foreign] }
        : { ...foreign, expectedEtag: '"1"', title: 'Attack', completed: true };
      const result = await clients[0].callTool({ name, arguments: args });
      assert.equal(
        result.isError,
        true,
        `${name} must not access another account's list`,
      );
    }

    const wildcard = await clients[0].callTool({
      name: 'update_task',
      arguments: {
        id: 'private-task',
        listId: users[0].id,
        expectedEtag: '*',
        title: 'Attack',
      },
    });
    assert.equal(wildcard.isError, true);

    const usersBefore = google.database
      .prepare('SELECT COUNT(*) AS count FROM user')
      .get().count;
    const badCallback = await fetch(
      `${origin}/api/auth/callback/google?state=invalid&code=invalid`,
      { redirect: 'manual' },
    );
    assert.equal(badCallback.status, 302);
    assert.equal(
      google.database.prepare('SELECT COUNT(*) AS count FROM user').get().count,
      usersBefore,
    );

    google.database
      .prepare('UPDATE account SET scope = ? WHERE userId = ?')
      .run('openid email', users[1].id);
    await assert.rejects(
      services.get(users[1].id).listTaskLists(),
      (error) => error.code === 'reconnect',
    );

    // Revoking pilot admission takes effect on existing sessions too.
    config.allowedEmails.delete(users[0].email);
    assert.equal(await google.getUser({ cookie: users[0].cookie }), null);
  } finally {
    await Promise.all(clients.map((client) => client.close()));
    await new Promise((resolve) => server.close(resolve));
    google.database.close();
  }
});

test('Invalid configuration never echoes secrets and production requires Google', () => {
  assert.throws(
    () =>
      readGoogleConfig({
        TASKS_MODE: 'google',
        BETTER_AUTH_SECRET: 'sensitive-value',
      }),
    (error) => !error.message.includes('sensitive-value'),
  );
  assert.throws(
    () => readGoogleConfig({ NODE_ENV: 'production' }),
    /Production requires TASKS_MODE=google/,
  );
});

test('Production requires a canonical HTTPS origin and closes local preview access', async () => {
  const environment = {
    NODE_ENV: 'production',
    TASKS_MODE: 'google',
    BETTER_AUTH_URL: 'https://tasks.example.com',
    BETTER_AUTH_SECRET: config.secret,
    GOOGLE_CLIENT_ID: config.clientId,
    GOOGLE_CLIENT_SECRET: config.clientSecret,
    PILOT_ALLOWED_EMAILS: 'one@example.com',
  };

  for (const baseURL of [
    'http://tasks.example.com',
    'http://127.0.0.1:3001',
    'https://tasks.example.com/path',
    'https://user:password@tasks.example.com',
    'https://tasks.example.com?query=1',
  ]) {
    assert.throws(() =>
      readGoogleConfig({ ...environment, BETTER_AUTH_URL: baseURL }),
    );
  }

  const production = readGoogleConfig(environment);
  const google = createGoogleAuth({ ...production, databasePath: ':memory:' });
  const server = createApp(google).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseURL = `http://127.0.0.1:${server.address().port}`;

  try {
    const preview = await fetch(`${baseURL}/api/google/mcp`, {
      method: 'POST',
      headers: { Origin: previewOrigin },
    });
    assert.equal(preview.status, 404);

    const disconnect = await fetch(`${baseURL}/api/google/disconnect`, {
      method: 'POST',
      headers: { Origin: previewOrigin },
    });
    assert.equal(disconnect.status, 403);
    assert.deepEqual(google.auth.options.trustedOrigins, [production.baseURL]);

    const metadata = await fetch(
      `${baseURL}/.well-known/oauth-protected-resource`,
    );
    assert.equal((await metadata.json()).resource, `${production.baseURL}/mcp`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    google.database.close();
  }
});
