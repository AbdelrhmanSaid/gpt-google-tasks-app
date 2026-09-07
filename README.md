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

The backend binds to loopback for local development. It implements stateless Streamable HTTP and exposes only `get_app_status`, a development tool. There is no Google authentication or task access yet. The UI previews interactive task cards using sample data; it is not yet registered as an MCP UI resource or connected to ChatGPT.

## Task-card preview

Use the preview scenario buttons to inspect one task, multiple tasks, no matches, loading, and a load error. Complete or reopen a task with its checkbox. Use Edit to change the title, notes, or scheduled date; Cancel discards the draft. The date picker uses shadcn Calendar and Popover components, supports month navigation and clearing the date, and keeps the selected day independent of timezone.

Enable **Simulate failed updates** to check error recovery. Failed saves keep the draft open; failed completion requests leave the task unchanged. Disable the simulation and retry to save. All updates are local to the page and reset on reload.

`apps/ui/src/tasks/` contains the reusable result, card, and editor components. Sample fixtures live in `apps/ui/src/preview/`; `App.tsx` supplies the preview controls and simulated update callback. Preview controls are not part of the future ChatGPT widget.

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

The UI uses local shadcn/ui components for buttons, checkboxes, inputs, labels, textareas, badges, and spinners. Tailwind utility classes handle all component layout and styling. `src/styles.css` contains only imports; `src/theme.css` contains shared color tokens and base styles. The MCP Apps bridge remains installed for the next integration step.

Component sources live in `apps/ui/src/components/ui`; CLI settings are in `apps/ui/components.json`. Add another component with `npx shadcn@latest add <component> --cwd apps/ui`. Keep project formatting and whitespace conventions when editing generated components.

## Next steps

1. Register the UI resource and wire the MCP Apps bridge and task tools.
2. Add OAuth, per-user Google connections, and the Google Tasks API.
3. Test with one account before inviting teammates.

Every future task operation must resolve credentials from the authenticated server-side identity. Never trust a model-supplied user ID to choose credentials. Google remains the source of truth. Store task dates as calendar dates, not timestamps.

## References

- [OpenAI MCP server guide](https://developers.openai.com/plugins/build/mcp-server)
- [OpenAI UI guide](https://developers.openai.com/plugins/build/chatgpt-ui)
- [OpenAI authentication guide](https://developers.openai.com/plugins/build/auth)
