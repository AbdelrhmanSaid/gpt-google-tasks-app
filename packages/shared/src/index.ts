/** Presentation model shared by the server and task cards. Type-only package. */
export interface Task {
  id: string;
  listId: string;
  listTitle: string;
  title: string;
  notes?: string | undefined;
  /** Calendar date (YYYY-MM-DD), without a time or timezone. */
  scheduledDate?: string | undefined;
  status: 'needsAction' | 'completed';
  webViewLink?: string;
}

export interface DemoTask extends Task {
  revision: number;
}

export interface TaskSnapshot {
  sampleData: true;
  demoSessionId: string;
  tasks: DemoTask[];
}
