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

export interface DemoTaskSnapshot {
  sampleData: true;
  demoSessionId: string;
  tasks: DemoTask[];
}

export interface TaskReference {
  id: string;
  listId: string;
}

export interface GoogleTask extends Task {
  etag: string;
}

export interface GoogleTaskSnapshot {
  sampleData: false;
  tasks: GoogleTask[];
  nextPageToken: string | null;
}

export type TaskSnapshot = DemoTaskSnapshot | GoogleTaskSnapshot;
