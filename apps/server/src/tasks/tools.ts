import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { DemoError, DemoStore } from './demoStore.js';
import { taskResourceUri } from '../ui/resource.js';

const sessionSchema = { demoSessionId: z.uuid() };
const selectionSchema = {
  ...sessionSchema,
  taskIds: z.array(z.string().min(1).max(100)).max(200),
};
const taskSchema = {
  ...sessionSchema,
  taskId: z.string().min(1).max(100),
  expectedRevision: z.number().int().positive(),
};
const editSchema = {
  title: z.string().trim().min(1).max(1024).optional(),
  notes: z.string().max(8192).nullable().optional(),
  scheduledDate: z.iso.date().nullable().optional(),
};
const readAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
const writeAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

function runOperation(operation: () => object): CallToolResult {
  try {
    const data = operation();

    return {
      content: [{ type: 'text', text: JSON.stringify(data) }],
      structuredContent: { ...data },
    };
  } catch (error) {
    if (!(error instanceof DemoError)) {
      throw error;
    }

    return { isError: true, content: [{ type: 'text', text: error.message }] };
  }
}

export function registerTaskTools(server: McpServer, store: DemoStore): void {
  server.registerTool(
    'start_demo',
    {
      description:
        'Start an isolated, temporary sample-data session. Call once per conversation and reuse demoSessionId. No Google account is connected. Sessions expire after one hour; the only sample list is Work (work).',
      inputSchema: {},
      annotations: writeAnnotations,
    },
    async () => runOperation(() => store.start()),
  );

  server.registerTool(
    'search_tasks',
    {
      description:
        'Search sample task titles and notes by case-insensitive substring. Empty query returns all tasks. Optionally filter status. Use render_tasks with matching IDs to display interactive cards. Ask for clarification when a requested edit matches multiple tasks.',
      inputSchema: {
        ...sessionSchema,
        query: z.string().max(1024),
        status: z.enum(['needsAction', 'completed']).optional(),
      },
      annotations: readAnnotations,
    },
    async ({ demoSessionId, query, status }) =>
      runOperation(() => store.search(demoSessionId, query, status)),
  );

  server.registerTool(
    'get_tasks',
    {
      description:
        'Fetch the latest sample tasks and revisions by ID. Use before retrying a stale edit.',
      inputSchema: selectionSchema,
      annotations: readAnnotations,
    },
    async ({ demoSessionId, taskIds }) =>
      runOperation(() => store.snapshot(demoSessionId, taskIds)),
  );

  server.registerTool(
    'create_task',
    {
      description:
        'Create a sample task in Work. Only create when requested. Dates are YYYY-MM-DD calendar dates, not timestamps. Call render_tasks afterward to show the created task. Retrying creates another task.',
      inputSchema: {
        ...sessionSchema,
        ...editSchema,
        title: z.string().trim().min(1).max(1024),
      },
      annotations: writeAnnotations,
    },
    async ({ demoSessionId, title, ...edits }) =>
      runOperation(() => store.create(demoSessionId, title, edits)),
  );

  server.registerTool(
    'update_task',
    {
      description:
        'Edit a sample task using its latest revision. Omit fields to preserve them; null clears notes or scheduledDate. Only change fields requested by the user. Does not change completion status.',
      inputSchema: { ...taskSchema, ...editSchema },
      annotations: writeAnnotations,
    },
    async ({ demoSessionId, taskId, expectedRevision, ...edits }) =>
      runOperation(() =>
        store.update(demoSessionId, taskId, expectedRevision, edits),
      ),
  );

  server.registerTool(
    'set_task_completed',
    {
      description:
        'Complete or reopen a sample task when requested, using its latest revision.',
      inputSchema: { ...taskSchema, completed: z.boolean() },
      annotations: writeAnnotations,
    },
    async ({ demoSessionId, taskId, expectedRevision, completed }) =>
      runOperation(() =>
        store.setCompleted(demoSessionId, taskId, expectedRevision, completed),
      ),
  );

  registerAppTool(
    server,
    'render_tasks',
    {
      description:
        'Display focused interactive cards for sample task IDs returned by search, creation, or an update. Pass an empty taskIds array to show no matches. Cards support editing, completing, and reopening.',
      inputSchema: selectionSchema,
      annotations: readAnnotations,
      _meta: { ui: { resourceUri: taskResourceUri } },
    },
    async ({ demoSessionId, taskIds }) =>
      runOperation(() => store.snapshot(demoSessionId, taskIds)),
  );
}
