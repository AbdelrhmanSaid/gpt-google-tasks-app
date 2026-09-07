import { z } from 'zod';
import type { TaskSnapshot } from '@tasks/shared';

// Validate host data at the bridge boundary before rendering task dates or IDs.
const snapshotSchema: z.ZodType<TaskSnapshot> = z.object({
  sampleData: z.literal(true),
  demoSessionId: z.uuid(),
  tasks: z.array(
    z.object({
      id: z.string(),
      listId: z.string(),
      listTitle: z.string(),
      title: z.string(),
      notes: z.string().optional(),
      scheduledDate: z.iso.date().optional(),
      status: z.enum(['needsAction', 'completed']),
      revision: z.number().int().positive(),
    }),
  ),
});

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
