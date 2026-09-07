# ChatGPT authorization

The server now implements OAuth authorization-code flow with S256 PKCE, explicit consent, rotating refresh tokens, revocation, and protected-resource discovery. Google credentials stay in the server's encrypted account storage. ChatGPT receives separate opaque app tokens, stored as hashes in SQLite.

The OAuth flow is tested locally. Production supports a canonical HTTPS origin behind a loopback reverse proxy, with the development preview endpoint disabled. See [VPS deployment](deployment.md) for setup. Connecting and testing inside ChatGPT remains a separate step.

## Local setup

```sh
npm run db:migrate -w @tasks/server
npm run dev
```

`npm run dev` builds both the authentication pages and task widget before starting the development servers. Rebuild the UI after changing authentication pages; the backend serves their built assets.

- Account connection and disconnect: `http://127.0.0.1:3001/connect.html`
- Google task preview: `http://127.0.0.1:5173/google.html`
- App-token protected MCP: `http://127.0.0.1:3001/mcp`

## Register the private ChatGPT client

Use a predefined public client for this pilot. Dynamic registration and client-management HTTP routes are disabled. Copy the **exact** callback URL from ChatGPT's app management page; do not guess a callback ID or use a wildcard. Then run on the server:

```sh
npm run oauth:register -w @tasks/server -- "https://chatgpt.com/connector/oauth/EXACT_CALLBACK_ID" "PILOT_OPERATOR_EMAIL"
```

The operator must already have signed in with an allowlisted Google account. The command creates a temporary internal operator session, registers the client through Better Auth, then deletes that temporary session. It prints a public client ID; there is no client secret. Repeating the command with the same callback returns the existing client ID.

Configure that ID in ChatGPT with token endpoint authentication method `none`. The client must use PKCE. The registration belongs to the service, so disconnecting the operator does not remove everybody else's client configuration.

ChatGPT currently shows `https://chatgpt.com/connector_platform_oauth_redirect`
for this server because it advertises RFC 9207 issuer identification. The CLI
accepts this exact stable callback as well as callback-ID-specific URLs. Always
copy the value displayed by ChatGPT. Include `offline_access` in base scopes so
it is requested even when ChatGPT selects tools with their own scope tags.

The CLI also accepts `http://127.0.0.1:5173/oauth-test.html` as a reserved local test redirect using native-app redirect rules. It is used for protocol/UI review, not a deployed callback page. The automated OAuth test uses its own isolated client and database.

## Protocol boundary

| Endpoint                                           | Purpose                                                                |
| -------------------------------------------------- | ---------------------------------------------------------------------- |
| `/.well-known/oauth-protected-resource/mcp`        | MCP resource and authorization-server discovery                        |
| `/.well-known/oauth-authorization-server/api/auth` | Authorization server metadata for the path-based issuer                |
| `/api/auth/oauth2/authorize`                       | Code flow; exact registered redirect and S256 PKCE                     |
| `/api/auth/oauth2/token`                           | Code exchange and refresh rotation                                     |
| `/api/auth/oauth2/consent`                         | Signed-request consent from an authenticated pilot user                |
| `/api/auth/oauth2/revoke`                          | App token revocation                                                   |
| `/mcp`                                             | Requires a valid app bearer token; browser cookies do not authorize it |

The root well-known URLs are compatibility aliases. Requested resource must be the canonical server URL plus `/mcp`. Tokens require the correct issuer, resource audience, expiration, and `tasks:manage` scope. `offline_access` allows refresh tokens. Tokens without a live, allowlisted user cannot access MCP.

Invalid requests receive HTTP 401 with `WWW-Authenticate` and the protected-resource metadata URL. Tool metadata advertises the OAuth scope. All Google task operations still resolve credentials from the authenticated server-side user, never a model-provided user ID.

The implementation follows [OpenAI authentication guidance](https://developers.openai.com/plugins/build/auth) using the [Better Auth OAuth provider](https://better-auth.com/docs/plugins/oauth-provider). No OpenAI API key is needed.

## Disconnect

Disconnect requires an authenticated browser session and a trusted Origin. A confirmation in the UI explains that access on all devices is removed while tasks remain in Google.

In one SQLite transaction, disconnect removes the user's app access/refresh tokens, consents, pending authorization codes, sessions, Google account credentials, and local identity. Reconnecting creates a new identity, preventing old grants from attaching to the new connection. The shared OAuth client registration and other users are preserved.

After local removal, the server attempts Google's token revocation endpoint. If Google cannot confirm revocation, the UI explicitly reports that local access is gone and directs the user to Google Account connections. Failure never restores local credentials or app tokens. Existing operations already sent to Google cannot be undone by disconnect.

## Verification

```sh
npm run build
npm run test:oauth -w @tasks/server
npm run test:google -w @tasks/server
npm run smoke -w @tasks/server
```

The OAuth test exercises real HTTP routes and Better Auth persistence with two synthetic users. It covers login redirect, public client details, consent approval/denial, signed-query tampering, redirect validation, PKCE failure, code replay, refresh rotation/replay, audience/scope/expiry rejection, bearer-only MCP access, revocation, and disconnect even when Google revocation fails. The connection and consent pages have also been reviewed in the browser with the configured Google account. No real Google account was disconnected during these checks.
