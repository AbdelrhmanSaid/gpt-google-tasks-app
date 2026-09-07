import { makeSignature } from 'better-auth/crypto';

import { loadLocalEnvironment, readGoogleConfig } from '../config.js';
import { createGoogleAuth } from './google.js';
import { mcpScope } from './oauth.js';

loadLocalEnvironment();

const config = readGoogleConfig();
const [redirectUri, operatorEmail] = process.argv.slice(2);

if (
  !config ||
  !redirectUri ||
  !operatorEmail ||
  !config.allowedEmails.has(operatorEmail.toLowerCase())
) {
  throw new Error(
    'Enable Google mode and pass the exact callback URL followed by a signed-in pilot email.',
  );
}

const callback = new URL(redirectUri);
const localTest =
  callback.origin === 'http://127.0.0.1:5173' &&
  callback.pathname === '/oauth-test.html';
const chatgpt =
  callback.origin === 'https://chatgpt.com' &&
  /^\/connector\/oauth\/[^/]+$/.test(callback.pathname);

if (
  (!localTest && !chatgpt) ||
  callback.search ||
  callback.hash ||
  callback.username ||
  callback.password
) {
  throw new Error(
    'Expected the exact ChatGPT connector callback or the documented local test callback.',
  );
}

const { auth, database } = createGoogleAuth(config);

try {
  const existing = database
    .prepare('SELECT clientId FROM oauthClient WHERE redirectUris = ?')
    .get(JSON.stringify([redirectUri]));

  if (existing) {
    console.log(`Existing public OAuth client ID: ${existing.clientId}`);
  } else {
    const context = await auth.$context;
    const operator =
      await context.internalAdapter.findUserByEmail(operatorEmail);

    if (!operator?.user.emailVerified) {
      throw new Error('The pilot operator must sign in through Google first.');
    }

    // The provider requires an operator session even for its server-only API.
    // This temporary CLI session never leaves the process and is removed below.
    const session = await context.internalAdapter.createSession(
      operator.user.id,
    );
    const signature = await makeSignature(session.token, config.secret);
    const headers = new Headers({
      Cookie: `${context.authCookies.sessionToken.name}=${encodeURIComponent(`${session.token}.${signature}`)}`,
    });

    try {
      const client = await auth.api.adminCreateOAuthClient({
        headers,
        body: {
          client_name: localTest ? 'Local OAuth test' : 'ChatGPT',
          application_type: localTest ? 'native' : 'web',
          redirect_uris: [redirectUri],
          token_endpoint_auth_method: 'none',
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          scope: `${mcpScope} offline_access`,
          require_pkce: true,
          skip_consent: false,
        },
      });

      // Public client IDs are identifiers, not credentials. PKCE protects exchange.
      console.log(`Public OAuth client ID: ${client.client_id}`);
    } finally {
      await context.internalAdapter.deleteSession(session.token);
    }
  }
} finally {
  database.close();
}
