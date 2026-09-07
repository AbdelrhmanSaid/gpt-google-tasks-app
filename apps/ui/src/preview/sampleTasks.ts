import type { Task } from '@tasks/shared';

export const sampleTasks: Task[] = [
  {
    id: 'homepage',
    listId: 'work',
    listTitle: 'Work',
    title: 'Review the new website homepage',
    notes: 'Check the mobile layout and send feedback on the headline.',
    scheduledDate: '2026-09-08',
    status: 'needsAction',
  },
  {
    id: 'copy',
    listId: 'work',
    listTitle: 'Work',
    title: 'Finish website launch copy',
    notes: 'About page and the short product descriptions.',
    scheduledDate: '2026-09-10',
    status: 'needsAction',
  },
  {
    id: 'assets',
    listId: 'work',
    listTitle: 'Work',
    title: 'Collect website brand assets',
    status: 'completed',
  },
];
