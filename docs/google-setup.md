# Google Cloud setup for the pilot

## Current local setup

Configured in Google Cloud project `abdelrhman-mcp` on 2026-09-07:

- Google Tasks API enabled.
- OAuth app `Tasks for ChatGPT`, External audience, Testing status.
- Project owner's Google account added as the first test user.
- Identity scopes and Google Tasks read/write scope saved.
- Web client `Tasks for ChatGPT - Local` created with the callback below.
- Credentials and a generated application secret saved in the Git-ignored `apps/server/.env`.

Local Google authentication and environment loading are implemented and tested. Production branding URLs and the VPS callback are not configured yet.

## Setup reference

Use an existing suitable Google Cloud project or create a dedicated one; enable **Google Tasks API** in that project. The callback below is implemented for local testing.

## Consent configuration

In Google Auth Platform, configure the app branding and support/contact email. Choose **External** because participants include personal or outside accounts. Start with publishing status **Testing** and add the exact Google account emails for you and each pilot participant under Test users. See Google's [consent-screen guide](https://developers.google.com/workspace/guides/configure-oauth-consent).

Under Data Access, configure these scopes:

```text
openid
https://www.googleapis.com/auth/userinfo.email
https://www.googleapis.com/auth/userinfo.profile
https://www.googleapis.com/auth/tasks
```

The application will use the OpenID aliases `email` and `profile` for the corresponding identity scopes. The Tasks read/write scope is required for the agreed mutations; see [Tasks scopes](https://developers.google.com/workspace/tasks/auth).

External apps in Testing that request Tasks access receive refresh tokens that expire after seven days. Reconnection during the pilot is therefore expected. Moving the audience to production is a separate Google release step; review Google's scope verification requirements before a broader rollout. See [Google refresh-token expiration](https://developers.google.com/identity/protocols/oauth2#expiration).

## OAuth client

Create an OAuth client with application type **Web application**. Use this exact local authorized redirect URI:

```text
http://127.0.0.1:3001/api/auth/callback/google
```

Our local `BETTER_AUTH_URL` is `http://127.0.0.1:3001`. Keep the hostname, port, and path consistent; `localhost` and `127.0.0.1` are different redirect URIs. Better Auth constructs its Google callback from the configured base URL and auth path. See its [Google setup guide](https://better-auth.com/docs/authentication/google).

The Google client returns to our backend, not to ChatGPT or the Vite UI. Google's client ID and secret are also distinct from the OAuth client that ChatGPT will use to access our server.

For the VPS, create a separate production Web application client and configure:

```text
https://YOUR_APP_HOSTNAME/api/auth/callback/google
```

Replace the placeholder only after choosing the hostname. Both clients may use the same pilot Cloud project initially.

## Local inputs

Copy `apps/server/.env.example` to `apps/server/.env` and enter the Google client ID, Google client secret, a generated application secret, and comma-separated pilot email addresses there. Do not paste secrets into chat or a `VITE_*` variable. The file is ignored by Git. Set `TASKS_MODE=google`, run the authentication migration, and open `/google.html` on the local UI.

`BETTER_AUTH_SECRET` has been generated locally for this installation. Keep it stable across restarts and store it separately from database backups. No service-account key or OpenAI API key is needed.

When the implementation is ready, the first live test is: sign in with your Google account, grant Tasks access, confirm the connected account, then search your tasks. Use a clearly named test task for the first create/edit/complete checks.
