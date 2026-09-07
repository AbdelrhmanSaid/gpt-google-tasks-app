import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import {
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// Load one immutable widget per server process. Its content hash changes the
// resource URI whenever a deployment changes the UI, invalidating host caches.
const html = await readFile(
  new URL('../../../ui/dist-widget/widget.html', import.meta.url),
  'utf8',
).catch(() => {
  throw new Error(
    'Task widget is missing. Run npm run build -w @tasks/ui first.',
  );
});

const version = createHash('sha256').update(html).digest('hex').slice(0, 16);

export const taskResourceUri = `ui://google-tasks/task-cards-${version}.html`;

export function registerTaskResource(server: McpServer): void {
  registerAppResource(server, 'Task cards', taskResourceUri, {}, async () => {
    return {
      contents: [
        {
          uri: taskResourceUri,
          mimeType: RESOURCE_MIME_TYPE,
          text: html,
          _meta: {
            ui: {
              prefersBorder: false,
              csp: { connectDomains: [], resourceDomains: [] },
            },
          },
        },
      ],
    };
  });
}
