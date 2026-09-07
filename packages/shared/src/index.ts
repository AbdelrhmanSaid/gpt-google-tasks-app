/** Presentation model shared by the server and task cards. Type-only package. */
export interface Task {
  id: string;
  listId: string;
  listTitle: string;
  title: string;
  notes?: string;
  /** Calendar date (YYYY-MM-DD), without a time or timezone. */
  scheduledDate?: string;
  status: 'needsAction' | 'completed';
  webViewLink?: string;
}
