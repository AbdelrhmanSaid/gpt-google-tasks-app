# Oracle VPS deployment

The pilot runs at `https://mcp.abdelrhmansaid.com` on Ubuntu 24.04 ARM64.
Nginx terminates HTTPS and forwards requests to a single Node.js process on
`127.0.0.1:3001`. The existing personal website has its own Nginx site.

Deployment verification passed: public HTTPS health and OAuth discovery,
unauthenticated MCP rejection, disabled local preview, browser Google sign-in,
and live task search/edit/date/conflict/complete/reopen checks. The existing
integration test task was left completed. ChatGPT connection testing is next.

The initial release is `20260908-01`, using Node.js `24.20.0`. Certbot issued the
subdomain certificate with automatic renewal. Google Cloud has a separate
`Tasks for ChatGPT - Production` web client with the callback below; the audience
remains external Testing.

## Files and ownership

- `/opt/node`: symlink to the installed Node.js 24 LTS release.
- `/opt/google-tasks/releases/<release>`: application source, dependencies, and builds.
- `/opt/google-tasks/current`: symlink to the active release.
- `/etc/google-tasks/environment`: production configuration, readable only by root.
- `/var/lib/google-tasks/auth.sqlite`: persistent authentication database, owned by
  the `google-tasks` service account. Its directory is mode `0700`.
- `/etc/systemd/system/google-tasks.service`: service definition from `deploy/`.
- `/etc/nginx/sites-available/google-tasks`: dedicated proxy site. Certbot adds
  the HTTPS certificate and HTTP redirect to the initial `deploy/nginx.conf`.

The service runs as `google-tasks`, cannot write to its release, and restarts on
failure. Production requires Google mode and a canonical HTTPS origin. Local
preview requests are disabled; `/mcp` requires an app OAuth bearer token.

## First deployment

Install the official ARM64 Node.js 24 LTS archive and verify its SHA-256 checksum
against Node.js's published `SHASUMS256.txt`. Set `/opt/node` to that version.
Create the service account, release directories, and persistent state directory.

Copy only Git-visible source files into a new release directory. Do not upload
local `.env` files, local authentication databases, or Windows `node_modules`.
With `/opt/node/bin` on `PATH`, run `npm ci`, `npm run build`, and the server tests.

Create `/etc/google-tasks/environment` using `deploy/environment.example`, with
a fresh random authentication secret and the production Google OAuth client.
The Google callback is:

```text
https://mcp.abdelrhmansaid.com/api/auth/callback/google
```

Run the compiled `apps/server/dist/auth/migrate.js` as the service user with the
production environment loaded. Install the systemd unit, set `current` to the
release, and enable the service. Keep port 3001 bound to loopback.

In Spaceship, create an A record for `mcp` pointing to `141.145.157.55`. Install
the Nginx site, validate with `sudo nginx -t`, and reload Nginx. Use the existing
Certbot installation to issue a certificate and configure HTTPS redirection.
The existing Certbot timer handles renewals.

## Verify and operate

```sh
sudo systemctl status google-tasks
sudo journalctl -u google-tasks -n 50 --no-pager
curl --fail https://mcp.abdelrhmansaid.com/health
curl --fail https://mcp.abdelrhmansaid.com/.well-known/oauth-protected-resource/mcp
curl -i -X POST https://mcp.abdelrhmansaid.com/mcp
```

The final request must return `401` with a `WWW-Authenticate` discovery challenge.
Check Google sign-in at `/connect.html`, then register ChatGPT's exact callback
using the compiled `dist/auth/registerClient.js` command as described in
[OAuth](oauth.md). Never print environment files or tokens to diagnose failures.
Nginx access logging is disabled for app requests because OAuth URLs contain codes.

## Updates and rollback

The VPS has a Git checkout at `/opt/google-tasks/repository` and the
`google-tasks-deploy` command installed from `deploy/update.sh`. After pushing
changes to GitHub's `master` branch, SSH in as `ubuntu` and run:

```sh
google-tasks-deploy
```

The command pulls with `git pull --ff-only`, copies that commit into a new
release, installs dependencies, builds, and runs all checks. It then switches
`current` atomically and restarts the service. A failed restart or health check
restores the previous release. Failed builds leave the running service alone.
The deployed commit is saved in `current/REVISION`; previous releases remain
available for rollback. Production secrets and the database stay outside Git.

Refresh Google Tasks in ChatGPT's plugin settings after changing tools or UI.
The widget resource URI includes a content hash to invalidate cached HTML.

To bootstrap the command on another server, create `/opt/google-tasks/repository`
owned by `ubuntu` (leave it empty for the first clone), ensure `releases` is also
owned by `ubuntu`, and install `deploy/update.sh` as
`/usr/local/bin/google-tasks-deploy` with root ownership and mode `755`.
Reinstall that command when changing the deployment script itself.

The update command does not run database migrations. If a future release changes
the authentication schema, follow the backup and migration procedure below
before activating it.

Build and test each update in a new release directory before changing `current`.
Record its Git commit. Stop the service before backing up the database or running
migrations. Copy the entire state directory, including any SQLite WAL files, to a
root-only backup directory, and preserve `/etc/google-tasks/environment` securely:
the encryption secret is required to recover Google tokens.

Run migrations as the service user, switch `current` to the tested release, and
start the service. Verify public health, discovery, and sign-in. Keep the previous
release until the update is verified.

If the update fails, stop the service and point `current` to the previous release.
Restore the matching database backup only if the migration is incompatible; this
discards any changes made after that backup. Start the service and verify again.
Do not rotate `BETTER_AUTH_SECRET` during routine updates.

Google's external Testing audience still limits who can connect and can require
periodic reconnection. Add teammates to both Google's test users and the server's
`PILOT_ALLOWED_EMAILS` before inviting them.
