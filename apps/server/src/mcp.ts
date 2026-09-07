import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { DemoStore } from './tasks/demoStore.js';
import { registerTaskTools } from './tasks/tools.js';
import { registerTaskResource } from './ui/resource.js';

export function createMcpServer(store: DemoStore): McpServer {
  const server = new McpServer({ name: 'google-tasks', version: '0.1.0' });

  server.registerTool(
    'get_app_status',
    {
      description:
        'Check the sample task integration status. Does not access Google Tasks.',
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => ({
      content: [
        {
          type: 'text',
          text: 'Sample task tools and cards are ready. Google connection is not configured.',
        },
      ],
      structuredContent: { ready: true, googleConnected: false },
    }),
  );

  registerTaskTools(server, store);
  registerTaskResource(server);

  return server;
}
