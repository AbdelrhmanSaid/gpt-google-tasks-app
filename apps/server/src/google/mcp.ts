import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { GoogleTasksError } from './errors.js';
import type { GoogleTasksClient } from './tasks.js';
import { registerTaskResource, taskResourceUri } from '../ui/resource.js';

const id = z.string().min(1).max(1024);
const reference = z.object({ id, listId: id });
const selection = { tasks: z.array(reference).max(50) };
const mutation = {
  ...reference.shape,
  // A wildcard would bypass optimistic concurrency. Accept only a quoted ETag.
  expectedEtag: z
    .string()
    .regex(/^"[^"\r\n]+"$/)
    .max(1024),
};
const edits = {
  title: z.string().trim().min(1).max(1024).optional(),
  notes: z.string().max(8192).nullable().optional(),
  scheduledDate: z.iso.date().nullable().optional(),
};
const pageToken = z.string().min(1).max(4096).optional();
const readAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};
const writeAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
};

async function runOperation(
  operation: () => Promise<object>,
): Promise<CallToolResult> {
  try {
    const result = await operation();

    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      structuredContent: { ...result },
    };
  } catch (error) {
    // Google response bodies and library errors can contain private data.
    const message =
      error instanceof GoogleTasksError
        ? error.message
        : 'The task request failed. Refresh before retrying a change.';

    return { isError: true, content: [{ type: 'text', text: message }] };
  }
}

export function createGoogleMcpServer(client: GoogleTasksClient): McpServer {
  const server = new McpServer({ name: 'google-tasks', version: '0.1.0' });

  server.registerTool(
    'list_task_lists',
    {
      description:
        'List the signed-in user’s Google task lists. Follow nextPageToken until null to see all lists. Use returned list IDs in task operations.',
      inputSchema: { pageToken },
      annotations: readAnnotations,
    },
    async ({ pageToken }) =>
      runOperation(() => client.listTaskLists(pageToken)),
  );

  server.registerTool(
    'search_tasks',
    {
      description:
        'Search one page of a Google task list by case-insensitive title/notes substring and optional status. Empty query matches all. IMPORTANT: follow nextPageToken even when tasks is empty; results are incomplete until it is null. Search other lists separately when needed. Render matching references with render_tasks; clarify ambiguous edits.',
      inputSchema: {
        listId: id,
        query: z.string().max(1024),
        status: z.enum(['needsAction', 'completed']).optional(),
        pageToken,
      },
      annotations: readAnnotations,
    },
    async ({ listId, query, status, pageToken }) =>
      runOperation(() => client.search(listId, query, status, pageToken)),
  );

  server.registerTool(
    'get_tasks',
    {
      description:
        'Fetch current tasks and ETags from the signed-in Google account. Refresh after a conflict before asking to retry an edit.',
      inputSchema: selection,
      annotations: readAnnotations,
    },
    async ({ tasks }) => runOperation(() => client.getTasks(tasks)),
  );

  server.registerTool(
    'create_task',
    {
      description:
        'Create a Google task only when requested, in the specified list. Dates are YYYY-MM-DD calendar dates. Retrying can create duplicates. Render the result afterward.',
      inputSchema: {
        listId: id,
        ...edits,
        title: z.string().trim().min(1).max(1024),
      },
      annotations: { ...writeAnnotations, destructiveHint: false },
    },
    async ({ listId, title, ...fields }) =>
      runOperation(() => client.create(listId, title, fields)),
  );

  server.registerTool(
    'update_task',
    {
      description:
        'Edit only requested Google task fields using its current ETag. Omit fields to preserve; null clears notes or date. Does not change completion. Do not blindly retry a conflict.',
      inputSchema: { ...mutation, ...edits },
      annotations: writeAnnotations,
    },
    async ({ id, listId, expectedEtag, ...fields }) =>
      runOperation(() => client.update({ id, listId }, expectedEtag, fields)),
  );

  server.registerTool(
    'set_task_completed',
    {
      description:
        'Complete or reopen the specified Google task when requested, using its current ETag.',
      inputSchema: { ...mutation, completed: z.boolean() },
      annotations: writeAnnotations,
    },
    async ({ id, listId, expectedEtag, completed }) =>
      runOperation(() =>
        client.setCompleted({ id, listId }, expectedEtag, completed),
      ),
  );

  registerAppTool(
    server,
    'render_tasks',
    {
      description:
        'Show focused, editable cards for up to 50 Google task references returned by search or a mutation. An empty array shows no matches.',
      inputSchema: selection,
      annotations: readAnnotations,
      _meta: { ui: { resourceUri: taskResourceUri } },
    },
    async ({ tasks }) => runOperation(() => client.getTasks(tasks)),
  );

  registerTaskResource(server);

  return server;
}
