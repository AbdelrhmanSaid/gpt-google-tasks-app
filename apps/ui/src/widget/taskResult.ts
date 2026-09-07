import { z } from 'zod';
import type { TaskSnapshot } from '@tasks/shared';

// Validate host data at the bridge boundary before rendering task dates or IDs.
const taskSchema = z.object({
  id: z.string(),
  listId: z.string(),
  listTitle: z.string(),
  title: z.string(),
  notes: z.string().optional(),
  scheduledDate: z.iso.date().optional(),
  status: z.enum(['needsAction', 'completed']),
});

const snapshotSchema: z.ZodType<TaskSnapshot> = z.discriminatedUnion(
  'sampleData',
  [
    z.object({
      sampleData: z.literal(true),
      demoSessionId: z.uuid(),
      tasks: z.array(
        taskSchema.extend({ revision: z.number().int().positive() }),
      ),
    }),
    z.object({
      sampleData: z.literal(false),
      tasks: z.array(taskSchema.extend({ etag: z.string() })),
      // ChatGPT can omit null fields when forwarding structured tool results.
      nextPageToken: z.string().nullable().default(null),
    }),
  ],
);

export function taskSelection(snapshot: TaskSnapshot): Record<string, unknown> {
  return snapshot.sampleData
    ? {
        demoSessionId: snapshot.demoSessionId,
        taskIds: snapshot.tasks.map((task) => task.id),
      }
    : { tasks: snapshot.tasks.map(({ id, listId }) => ({ id, listId })) };
}

export function mergeTaskResult(
  current: TaskSnapshot | null,
  saved: TaskSnapshot,
): TaskSnapshot | null {
  if (
    current?.sampleData === true &&
    saved.sampleData &&
    current.demoSessionId === saved.demoSessionId
  ) {
    return {
      ...current,
      tasks: current.tasks.map(
        (task) => saved.tasks.find((item) => item.id === task.id) ?? task,
      ),
    };
  }

  if (current?.sampleData === false && !saved.sampleData) {
    return {
      ...current,
      tasks: current.tasks.map(
        (task) =>
          saved.tasks.find(
            (item) => item.id === task.id && item.listId === task.listId,
          ) ?? task,
      ),
    };
  }

  return current;
}

export function readTaskResult(result: {
  isError?: boolean | undefined;
  structuredContent?: Record<string, unknown> | undefined;
}): TaskSnapshot {
  if (result.isError) {
    throw new Error(
      'The task request failed. Refresh the cards before retrying.',
    );
  }

  return snapshotSchema.parse(result.structuredContent);
}
