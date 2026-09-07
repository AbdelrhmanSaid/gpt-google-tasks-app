import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: 'google-tasks', version: '0.1.0' });

  server.registerTool(
    'get_app_status',
    {
      description:
        'Check the development scaffold status. Does not access Google Tasks.',
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
          text: 'Codebase ready. Google connection is not configured.',
        },
      ],
      structuredContent: { ready: true, googleConnected: false },
    }),
  );

  return server;
}
