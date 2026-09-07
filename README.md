# Google Tasks for ChatGPT

A private pilot for individual Google Tasks accounts. Conversation drives the workflow; focused task cards provide completion and minor editing controls. No shared tasks or full task-manager dashboard.

## Requirements

- Node.js 22.13 or newer and npm (uses built-in SQLite).
- No credentials are needed for the sample-data integration.

## Run locally

```sh
npm ci
npm run dev
```

- UI development preview: http://127.0.0.1:5173
- MCP integration preview: http://127.0.0.1:5173/integration.html
- MCP endpoint: http://127.0.0.1:3001/mcp
- Health endpoint: http://127.0.0.1:3001/health

The backend binds to loopback and implements stateless Streamable HTTP. Without `TASKS_MODE=google`, it runs the sample integration. Google mode enables real per-user task access through the local authenticated preview and blocks `/mcp` until hosted OAuth is implemented.

### Connect Google locally

Copy `apps/server/.env.example` to `apps/server/.env`, fill in the Google client credentials, a stable random `BETTER_AUTH_SECRET` of at least 32 characters, and the pilot email allowlist. Follow [Google Cloud setup](docs/google-setup.md) for the client and test users. Then run:

```sh
npm run db:migrate -w @tasks/server
npm run dev
```

Open http://127.0.0.1:5173/google.html and connect Google. Select a task list, search or create a task, then use the embedded cards to edit, complete, or reopen it. These controls simulate a conversation for local development. Changes save to the connected Google account.

Google credentials are encrypted in `apps/server/data/auth.sqlite` using the application secret. Both the database directory and `.env` are ignored by Git. Keep the secret stable across restarts. Sign out ends the browser session; it does not revoke Google's grant. Full disconnect/revocation and ChatGPT OAuth remain in the next authentication step. You can revoke the grant through Google Account connections meanwhile.

Google tools include `list_task_lists`; task references use `(listId, id)` and mutations require `expectedEtag`. Search examines 50 tasks per page. Follow `nextPageToken` until null, even if a page has no matches. Live testing confirmed that stale ETags are rejected by Google rather than overwriting a newer edit.

`npm run dev` builds the embedded widget before starting both development servers. The standalone preview updates through Vite. After changing embedded UI code, run `npm run build:widget -w @tasks/ui`, reload the integration preview, and search again to load the new resource.

## Sample MCP integration

The integration preview connects to the real MCP server through Vite's local proxy. Its development controls stand in for the conversation: search or create a task, then edit or complete it inside the embedded card. Search again to verify persistence. The frame receives the built HTML through `resources/read` and calls server tools through the MCP Apps bridge. It also sends updated task context to the host without triggering an assistant reply.

This harness tests the protocol locally; it is not a ChatGPT connection or a production host. It permits scripts and forms inside an iframe with an isolated origin. The widget itself contains no preview controls or direct HTTP calls to the backend.

| Tool                 | Purpose                                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| `get_app_status`     | Report readiness and the disconnected Google account state.                                    |
| `start_demo`         | Create an isolated set of sample tasks; reuse its `demoSessionId` throughout the conversation. |
| `search_tasks`       | Search titles and notes by substring, optionally filtering completion status.                  |
| `get_tasks`          | Refresh known task IDs and their revisions.                                                    |
| `create_task`        | Create a task in the sample Work list.                                                         |
| `update_task`        | Edit title, notes, or scheduled date; null clears optional fields.                             |
| `set_task_completed` | Complete or reopen a task.                                                                     |
| `render_tasks`       | Show cards for task IDs returned by the data tools.                                            |

Only `render_tasks` advertises a UI resource. Search and mutation tools return structured data so the assistant can use them without opening a card on every call. Mutations require the latest `expectedRevision`; stale edits return an error instead of overwriting newer values. Cancel an old draft, refresh the cards, and retry. Creation is not idempotent: repeating the call creates another task.

Sample data lives in server memory, expires one hour after session creation, and resets when the server restarts. Each session has one Work list and supports up to 200 tasks; at most 100 sessions can coexist. Demo session IDs identify fake data buckets, **not authenticated users**. Do not store personal task data in this demo. Real accounts will use server-side OAuth identity instead.

To test in ChatGPT, connect this MCP endpoint using a supported tunnel or HTTPS endpoint, then follow the [ChatGPT connection guide](https://developers.openai.com/plugins/deploy/connect-chatgpt). Refresh the connection's tool definitions after changes. A useful first prompt is: “Start a sample task session, find my website tasks, and show the cards.” Actual ChatGPT connection testing remains separate from the local harness.

## Task-card preview

Use the preview scenario buttons to inspect one task, multiple tasks, no matches, loading, and a load error. Complete or reopen a task with its checkbox. Use Edit to change the title, notes, or scheduled date; Cancel discards the draft. The date picker uses shadcn Calendar and Popover components, supports month navigation and clearing the date, and keeps the selected day independent of timezone.

Enable **Simulate failed updates** to check error recovery. Failed saves keep the draft open; failed completion requests leave the task unchanged. Disable the simulation and retry to save. All updates are local to the page and reset on reload.

`apps/ui/src/tasks/` contains the reusable result, card, and editor components. Sample fixtures live in `apps/ui/src/preview/`; `App.tsx` supplies the preview controls and simulated update callback. Preview controls are not part of the future ChatGPT widget.

The server loads `apps/server/.env`; existing process environment variables take precedence. The optional `PORT` defaults to 3001. Google mode uses the exact configured local callback on port 3001. Never put credentials in UI code or `VITE_*` variables.

## Workspace

```text
apps/server/       Authentication, Google API access, MCP tools, and UI resource
apps/ui/           Shared task cards, standalone preview, and embedded widget
packages/shared/   Type-only task presentation contracts
```

## Checks and production builds

```sh
npm run typecheck
npm run format:check
npm run build
npm run smoke -w @tasks/server
npm run test:google -w @tasks/server
npm run start -w @tasks/server
```

Run `npm run format` to format source files. Build output goes to each app's `dist/` directory, plus `apps/ui/dist-widget/widget.html` for the self-contained widget. The server reads this HTML through MCP resources, so keep the sibling app directories together when running the built server.

The smoke check starts a temporary server on port 3099, verifies health, tool discovery, bundled resource delivery, search, creation, edits, completion/reopening, invalid dates, stale revisions, and session isolation, then stops it. Leave that port free when running the check. Build the UI and server first.

The Google tests use an isolated in-memory auth database and a mocked Google network boundary. They verify real session validation, pilot admission, encrypted token resolution, cross-account reads/writes, protected routes, pagination, conditional requests, field clearing, and safe errors. They never use your live credentials.

After creating one uniquely named test task in the preview, an optional operator-run check is available:

```sh
node apps/server/scripts/live-google.mjs YOUR_PILOT_EMAIL "EXACT_LIST_TITLE" "ChatGPT integration test YOUR_UNIQUE_SUFFIX"
```

It modifies only that exact test task, verifies stale-write rejection against Google, then leaves the task completed with notes/date cleared. It never deletes tasks. Do not use a task containing information you want to preserve.

The UI uses local shadcn/ui components for buttons, checkboxes, inputs, labels, textareas, badges, spinners, and the date picker. Tailwind utility classes handle all component layout and styling. `src/styles.css` contains only imports; `src/theme.css` contains shared color tokens and base styles. `src/widget/` owns the MCP Apps bridge; task-card components do not depend on the host SDK.

Component sources live in `apps/ui/src/components/ui`; CLI settings are in `apps/ui/components.json`. Add another component with `npx shadcn@latest add <component> --cwd apps/ui`. Keep project formatting and whitespace conventions when editing generated components.

## Next steps

1. Add ChatGPT-facing MCP OAuth and full disconnect/revocation; test authorization locally.
2. Deploy to the VPS with HTTPS and persistent credential storage.
3. Connect the hosted endpoint to ChatGPT and test before inviting teammates.

The [authentication design](docs/authentication.md) distinguishes the implemented Google connection from the remaining hosted OAuth flow. `NODE_ENV=production` is refused until that boundary is ready.

Every future task operation must resolve credentials from the authenticated server-side identity. Never trust a model-supplied user ID to choose credentials. Google remains the source of truth. Store task dates as calendar dates, not timestamps.

## References

- [OpenAI MCP server guide](https://developers.openai.com/plugins/build/mcp-server)
- [OpenAI UI guide](https://developers.openai.com/plugins/build/chatgpt-ui)
- [OpenAI authentication guide](https://developers.openai.com/plugins/build/auth)
