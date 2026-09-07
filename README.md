# Google Tasks for ChatGPT

A private pilot for individual Google Tasks accounts. Conversation drives the workflow; focused task cards provide completion and minor editing controls. No shared tasks or full task-manager dashboard.

## Requirements

- Node.js 22.12 or newer and npm.
- No credentials are needed for this scaffold.

## Run locally

```sh
npm ci
npm run dev
```

- UI development preview: http://127.0.0.1:5173
- MCP endpoint: http://127.0.0.1:3001/mcp
- Health endpoint: http://127.0.0.1:3001/health

The backend binds to loopback for local development. It implements stateless Streamable HTTP and exposes only `get_app_status`, a development tool. There is no Google authentication or task access yet. The UI is a standalone placeholder, not yet registered as an MCP UI resource or connected to ChatGPT.

The server reads the optional `PORT` environment variable (default 3001). No `.env` loader is configured yet. Never put credentials in UI code or `VITE_*` variables.

## Workspace

```text
apps/server/       TypeScript MCP backend and HTTP health endpoint
apps/ui/           React + Vite task-card UI development preview
packages/shared/   Type-only task presentation contracts
```

## Checks and production builds

```sh
npm run typecheck
npm run format:check
npm run build
npm run smoke -w @tasks/server
npm run start -w @tasks/server
```

Run `npm run format` to format source files. Build output goes to each app's `dist/` directory. The server does not serve the UI bundle yet.

The smoke check starts a temporary server on port 3099, verifies HTTP health and a complete MCP tool call, then stops it. Leave that port free when running the check.

The MCP Apps bridge dependency is installed for the next UI step. OpenAI's optional component library is deferred: its current release brings a dependency flagged by npm audit. This does not affect using the MCP Apps UI protocol.

## Next steps

1. Build task cards using sample data.
2. Register the UI resource and wire the MCP Apps bridge and task tools.
3. Add OAuth, per-user Google connections, and the Google Tasks API.
4. Test with one account before inviting teammates.

Every future task operation must resolve credentials from the authenticated server-side identity. Never trust a model-supplied user ID to choose credentials. Google remains the source of truth. Store task dates as calendar dates, not timestamps.

## References

- [OpenAI MCP server guide](https://developers.openai.com/plugins/build/mcp-server)
- [OpenAI UI guide](https://developers.openai.com/plugins/build/chatgpt-ui)
- [OpenAI authentication guide](https://developers.openai.com/plugins/build/auth)
