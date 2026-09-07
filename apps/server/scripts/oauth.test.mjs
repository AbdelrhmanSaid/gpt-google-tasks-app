import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';

import { getMigrations } from 'better-auth/db/migration';
import { makeSignature, symmetricEncrypt } from 'better-auth/crypto';

import { createApp } from '../dist/app.js';
import { createGoogleAuth, tasksScope } from '../dist/auth/google.js';
import { disconnectGoogle } from '../dist/auth/disconnect.js';

const callback = 'http://127.0.0.1:5173/oauth-test.html';
const config = {
  baseURL: 'http://127.0.0.1:3001',
  secret: 'oauth-test-secret-with-no-production-value',
  clientId: 'test.apps.googleusercontent.com',
  clientSecret: 'test-only',
  allowedEmails: new Set(['oauth-one@example.com', 'oauth-two@example.com']),
  databasePath: ':memory:',
};
const resource = `${config.baseURL}/mcp`;

test('OAuth authorization, PKCE, refresh, revocation, and disconnect lifecycle', async () => {
  const google = createGoogleAuth(config);
  await (await getMigrations(google.auth.options)).runMigrations();
  const context = await google.auth.$context;
  const users = [];

  for (const email of config.allowedEmails) {
    const user = await context.internalAdapter.createUser({
      email,
      emailVerified: true,
      name: 'OAuth test user',
    });
    const session = await context.internalAdapter.createSession(user.id);
    const signature = await makeSignature(session.token, config.secret);
    const cookie = `${context.authCookies.sessionToken.name}=${encodeURIComponent(`${session.token}.${signature}`)}`;

    await context.internalAdapter.createAccount({
      userId: user.id,
      providerId: 'google',
      accountId: `google-${user.id}`,
      scope: tasksScope,
      accessToken: await symmetricEncrypt({
        key: config.secret,
        data: 'fake-google-access',
      }),
      refreshToken: await symmetricEncrypt({
        key: config.secret,
        data: 'fake-google-refresh',
      }),
    });
    users.push({ ...user, cookie });
  }

  const client = await google.auth.api.adminCreateOAuthClient({
    headers: new Headers({ Cookie: users[0].cookie }),
    body: {
      client_name: 'OAuth test client',
      application_type: 'native',
      redirect_uris: [callback],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      scope: 'tasks:manage offline_access',
      require_pkce: true,
      skip_consent: false,
    },
  });
  const calls = [];
  const app = createApp({
    ...google,
    tasksForUser: (userId) => ({
      listTaskLists: async () => {
        calls.push(userId);
        return { lists: [], nextPageToken: null };
      },
    }),
    disconnect: (userId) =>
      disconnectGoogle(google.database, config, userId, async (_url, init) => {
        assert.equal(init.body.get('token'), 'fake-google-refresh');
        assert.equal(
          google.database
            .prepare('SELECT COUNT(*) AS count FROM user WHERE id = ?')
            .get(userId).count,
          0,
          'local identity must be gone before revocation',
        );
        return new Response('', { status: 503 });
      }),
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;

  async function authorize(user = users[0], changes = {}) {
    const verifier = randomBytes(32).toString('base64url');
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: client.client_id,
      redirect_uri: callback,
      scope: 'tasks:manage offline_access',
      resource,
      state: 'test-state',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      prompt: 'consent',
      ...changes,
    });
    const response = await fetch(
      `${origin}/api/auth/oauth2/authorize?${query}`,
      {
        headers: {
          Accept: 'application/json',
          ...(user ? { Cookie: user.cookie } : {}),
        },
        redirect: 'manual',
      },
    );
    const result = await response.json();

    return { response, result, verifier };
  }

  async function consent(request, accept = true, user = users[0]) {
    const query = new URL(request.result.url).search.slice(1);
    const response = await fetch(`${origin}/api/auth/oauth2/consent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: config.baseURL,
        Cookie: user.cookie,
      },
      body: JSON.stringify({ accept, oauth_query: query }),
    });
    assert.equal(response.status, 200);
    const result = await response.json();

    return new URL(result.url);
  }

  async function token(body) {
    const response = await fetch(`${origin}/api/auth/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: client.client_id, ...body }),
    });

    return { status: response.status, body: await response.json() };
  }

  async function issue(user = users[0], changes = {}) {
    const request = await authorize(user, changes);
    const redirect = await consent(request, true, user);
    const code = redirect.searchParams.get('code');
    assert.ok(code, 'consent must return an authorization code');
    assert.equal(redirect.searchParams.get('state'), 'test-state');
    assert.equal(
      redirect.searchParams.get('iss'),
      `${config.baseURL}/api/auth`,
    );
    const issued = await token({
      grant_type: 'authorization_code',
      code,
      redirect_uri: callback,
      code_verifier: request.verifier,
      resource,
    });
    assert.equal(issued.status, 200, JSON.stringify(issued.body.error));

    return { ...issued.body, code, verifier: request.verifier };
  }

  try {
    const discovery = await (
      await fetch(`${origin}/.well-known/oauth-authorization-server/api/auth`)
    ).json();
    assert.deepEqual(discovery.code_challenge_methods_supported, ['S256']);
    assert.equal(discovery.registration_endpoint, undefined);
    assert.equal(
      (
        await (
          await fetch(`${origin}/.well-known/oauth-protected-resource/mcp`)
        ).json()
      ).resource,
      resource,
    );

    const anonymous = await authorize(null);
    assert.equal(new URL(anonymous.result.url).pathname, '/connect.html');
    const publicClient = await fetch(
      `${origin}/api/auth/oauth2/public-client-prelogin`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: config.baseURL },
        body: JSON.stringify({
          client_id: client.client_id,
          oauth_query: new URL(anonymous.result.url).search.slice(1),
        }),
      },
    );
    assert.equal(publicClient.status, 200);
    assert.equal((await publicClient.json()).client_name, 'OAuth test client');
    const invalidRedirect = await authorize(users[0], {
      redirect_uri: 'https://attacker.example/callback',
    });
    assert.ok(
      invalidRedirect.response.status >= 400 ||
        (new URL(invalidRedirect.result.url).origin === config.baseURL &&
          new URL(invalidRedirect.result.url).searchParams.has('error')),
    );
    const plain = await authorize(users[0], { code_challenge_method: 'plain' });
    assert.ok(
      plain.response.status >= 400 ||
        new URL(plain.result.url).searchParams.has('error'),
    );
    const noPkce = await authorize(users[0], {
      code_challenge: '',
      code_challenge_method: '',
    });
    assert.ok(
      noPkce.response.status >= 400 ||
        new URL(noPkce.result.url).searchParams.has('error'),
    );

    const denied = await consent(await authorize(), false);
    assert.equal(denied.searchParams.get('error'), 'access_denied');

    const request = await authorize();
    const tampered = new URL(request.result.url);
    tampered.searchParams.set(
      'redirect_uri',
      'https://attacker.example/callback',
    );
    const tamperResponse = await fetch(`${origin}/api/auth/oauth2/consent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: config.baseURL,
        Cookie: users[0].cookie,
      },
      body: JSON.stringify({
        accept: true,
        oauth_query: tampered.search.slice(1),
      }),
    });
    assert.equal(tamperResponse.status, 400);

    const badCodeRedirect = await consent(await authorize());
    const badVerifier = await token({
      grant_type: 'authorization_code',
      code: badCodeRedirect.searchParams.get('code'),
      redirect_uri: callback,
      code_verifier: randomBytes(32).toString('base64url'),
      resource,
    });
    assert.ok([400, 401].includes(badVerifier.status));
    assert.ok(
      ['invalid_grant', 'invalid_request'].includes(badVerifier.body.error),
    );

    let first = await issue();
    assert.ok(first.refresh_token);
    assert.equal(
      (await google.getBearerUser(`Bearer ${first.access_token}`)).id,
      users[0].id,
    );
    assert.equal(
      await google.getBearerUser(`Bearer ${first.refresh_token}`),
      null,
    );
    assert.equal(await google.getBearerUser('Bearer fake-google-access'), null);
    assert.equal(await google.getBearerUser('Bearer forged'), null);

    const response = await fetch(`${origin}/mcp`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${first.access_token}`,
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'list_task_lists', arguments: { userId: users[1].id } },
      }),
    });
    assert.equal(response.status, 200);
    assert.equal(calls.at(-1), users[0].id);
    const missingBearer = await fetch(`${origin}/mcp`, {
      method: 'POST',
      headers: { Cookie: users[0].cookie },
    });
    assert.equal(missingBearer.status, 401);
    assert.ok(
      missingBearer.headers
        .get('www-authenticate')
        .includes('resource_metadata'),
    );

    const replay = await token({
      grant_type: 'authorization_code',
      code: first.code,
      redirect_uri: callback,
      code_verifier: first.verifier,
      resource,
    });
    assert.equal(replay.status, 400);
    assert.equal(
      await google.getBearerUser(`Bearer ${first.access_token}`),
      null,
    );

    first = await issue();
    const rotated = await token({
      grant_type: 'refresh_token',
      refresh_token: first.refresh_token,
      resource,
    });
    assert.equal(rotated.status, 200);
    assert.notEqual(rotated.body.refresh_token, first.refresh_token);
    assert.equal(
      (await google.getBearerUser(`Bearer ${rotated.body.access_token}`)).id,
      users[0].id,
    );
    const reusedRefresh = await token({
      grant_type: 'refresh_token',
      refresh_token: first.refresh_token,
      resource,
    });
    assert.equal(reusedRefresh.status, 400);
    assert.equal(
      await google.getBearerUser(`Bearer ${rotated.body.access_token}`),
      null,
    );

    const limited = await issue(users[0], { scope: 'offline_access' });
    assert.equal(
      await google.getBearerUser(`Bearer ${limited.access_token}`),
      null,
    );
    first = await issue();
    google.database
      .prepare('UPDATE oauthAccessToken SET resources = ? WHERE userId = ?')
      .run(JSON.stringify(['https://wrong.example/mcp']), users[0].id);
    assert.equal(
      await google.getBearerUser(`Bearer ${first.access_token}`),
      null,
    );
    first = await issue();
    google.database
      .prepare('UPDATE oauthAccessToken SET expiresAt = 0 WHERE userId = ?')
      .run(users[0].id);
    assert.equal(
      await google.getBearerUser(`Bearer ${first.access_token}`),
      null,
    );

    first = await issue();
    const revoke = await fetch(`${origin}/api/auth/oauth2/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: client.client_id,
        token: first.refresh_token,
        token_type_hint: 'refresh_token',
      }),
    });
    assert.equal(revoke.status, 200);
    assert.equal(
      await google.getBearerUser(`Bearer ${first.access_token}`),
      null,
    );

    first = await issue();
    const second = await issue(users[1]);
    config.allowedEmails.delete(users[0].email);
    assert.equal(
      await google.getBearerUser(`Bearer ${first.access_token}`),
      null,
    );
    config.allowedEmails.add(users[0].email);

    const foreignDisconnect = await fetch(`${origin}/api/google/disconnect`, {
      method: 'POST',
      headers: { Cookie: users[0].cookie, Origin: 'https://attacker.example' },
    });
    assert.equal(foreignDisconnect.status, 403);
    assert.equal(
      (await google.getBearerUser(`Bearer ${first.access_token}`)).id,
      users[0].id,
    );
    const pending = await authorize();
    const pendingRedirect = await consent(pending);
    const disconnect = await fetch(`${origin}/api/google/disconnect`, {
      method: 'POST',
      headers: { Cookie: users[0].cookie, Origin: config.baseURL },
    });
    assert.equal(disconnect.status, 200);
    assert.deepEqual(await disconnect.json(), { googleRevoked: false });
    assert.equal(await google.getUser({ cookie: users[0].cookie }), null);
    assert.equal(
      await google.getBearerUser(`Bearer ${first.access_token}`),
      null,
    );
    assert.equal(
      (await google.getBearerUser(`Bearer ${second.access_token}`)).id,
      users[1].id,
    );
    assert.equal(
      (
        await token({
          grant_type: 'refresh_token',
          refresh_token: first.refresh_token,
          resource,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await token({
          grant_type: 'authorization_code',
          code: pendingRedirect.searchParams.get('code'),
          redirect_uri: callback,
          code_verifier: pending.verifier,
          resource,
        })
      ).status,
      400,
    );

    const reconnected = await context.internalAdapter.createUser({
      email: users[0].email,
      emailVerified: true,
      name: 'Reconnected',
    });
    assert.notEqual(reconnected.id, users[0].id);
    assert.equal(
      await google.getBearerUser(`Bearer ${first.access_token}`),
      null,
    );
    assert.deepEqual(
      await disconnectGoogle(
        google.database,
        config,
        users[1].id,
        async () => new Response('', { status: 200 }),
      ),
      { googleRevoked: true },
    );
    assert.equal(
      await google.getBearerUser(`Bearer ${second.access_token}`),
      null,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    google.database.close();
  }
});
