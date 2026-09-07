import { readFile } from 'node:fs/promises';

import {
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export const taskResourceUri = 'ui://google-tasks/task-cards.html';

export function registerTaskResource(server: McpServer): void {
  registerAppResource(server, 'Task cards', taskResourceUri, {}, async () => {
    // src/ui and dist/ui have the same depth. The widget is self-contained,
    // so the host needs no access to localhost assets or third-party CDNs.
    const path = new URL(
      '../../../ui/dist-widget/widget.html',
      import.meta.url,
    );
    const html = await readFile(path, 'utf8').catch(() => {
      throw new Error(
        'Task widget is missing. Run npm run build -w @tasks/ui first.',
      );
    });

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
