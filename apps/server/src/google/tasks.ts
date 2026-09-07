import type {
  GoogleTask,
  GoogleTaskSnapshot,
  TaskReference,
} from '@tasks/shared';
import { z } from 'zod';

import { GoogleTasksError } from './errors.js';

const apiOrigin = 'https://tasks.googleapis.com/tasks/v1';
const listSchema = z.object({ id: z.string(), title: z.string() });
const taskSchema = z.object({
  id: z.string(),
  title: z.string(),
  etag: z.string(),
  notes: z.string().optional(),
  due: z.string().optional(),
  status: z.enum(['needsAction', 'completed']),
});
const taskPageSchema = z.object({
  items: z.array(taskSchema).default([]),
  nextPageToken: z.string().optional(),
});
const listPageSchema = z.object({
  items: z.array(listSchema).default([]),
  nextPageToken: z.string().optional(),
});

export interface TaskEdits {
  title?: string;
  notes?: string | null;
  scheduledDate?: string | null;
}

export class GoogleTasksClient {
  constructor(
    private readonly getAccessToken: () => Promise<string>,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async listTaskLists(pageToken?: string) {
    const params = new URLSearchParams({ maxResults: '100' });

    if (pageToken) {
      params.set('pageToken', pageToken);
    }

    const page = listPageSchema.parse(
      await this.request(`/users/@me/lists?${params}`),
    );

    return { lists: page.items, nextPageToken: page.nextPageToken ?? null };
  }

  async search(
    listId: string,
    query: string,
    status?: GoogleTask['status'],
    pageToken?: string,
  ): Promise<GoogleTaskSnapshot> {
    const list = await this.getList(listId);
    const params = new URLSearchParams({
      maxResults: '50',
      showCompleted: 'true',
      showHidden: 'true',
      showDeleted: 'false',
    });

    if (pageToken) {
      params.set('pageToken', pageToken);
    }

    const page = taskPageSchema.parse(
      await this.request(
        `/lists/${encodeURIComponent(list.id)}/tasks?${params}`,
      ),
    );
    const phrase = query.trim().toLowerCase();
    const tasks = page.items
      .filter((task) => {
        const text = `${task.title}\n${task.notes ?? ''}`.toLowerCase();

        return text.includes(phrase) && (!status || task.status === status);
      })
      .map((task) => this.toTask(task, list));

    return {
      sampleData: false,
      tasks,
      nextPageToken: page.nextPageToken ?? null,
    };
  }

  async getTasks(references: TaskReference[]): Promise<GoogleTaskSnapshot> {
    const tasks: GoogleTask[] = [];
    const lists = new Map<string, z.infer<typeof listSchema>>();

    for (const reference of references) {
      let list = lists.get(reference.listId);

      if (!list) {
        list = await this.getList(reference.listId);
        lists.set(reference.listId, list);
      }

      const task = taskSchema.parse(
        await this.request(this.taskPath(reference)),
      );
      tasks.push(this.toTask(task, list));
    }

    return { sampleData: false, tasks, nextPageToken: null };
  }

  async create(
    listId: string,
    title: string,
    edits: TaskEdits,
  ): Promise<GoogleTaskSnapshot> {
    const list = await this.getList(listId);
    const task = taskSchema.parse(
      await this.request(`/lists/${encodeURIComponent(list.id)}/tasks`, {
        method: 'POST',
        body: JSON.stringify({ ...this.editBody(edits), title }),
      }),
    );

    return {
      sampleData: false,
      tasks: [this.toTask(task, list)],
      nextPageToken: null,
    };
  }

  async update(
    reference: TaskReference,
    etag: string,
    edits: TaskEdits,
  ): Promise<GoogleTaskSnapshot> {
    return this.patch(reference, etag, this.editBody(edits));
  }

  async setCompleted(
    reference: TaskReference,
    etag: string,
    completed: boolean,
  ): Promise<GoogleTaskSnapshot> {
    return this.patch(
      reference,
      etag,
      completed
        ? { status: 'completed' }
        : { status: 'needsAction', completed: null },
    );
  }

  private async patch(
    reference: TaskReference,
    etag: string,
    body: Record<string, unknown>,
  ): Promise<GoogleTaskSnapshot> {
    const list = await this.getList(reference.listId);
    const task = taskSchema.parse(
      await this.request(this.taskPath(reference), {
        method: 'PATCH',
        headers: { 'If-Match': etag },
        body: JSON.stringify(body),
      }),
    );

    return {
      sampleData: false,
      tasks: [this.toTask(task, list)],
      nextPageToken: null,
    };
  }

  private editBody(edits: TaskEdits): Record<string, unknown> {
    const body: Record<string, unknown> = {};

    if (edits.title !== undefined) {
      body.title = edits.title;
    }

    if (edits.notes !== undefined) {
      body.notes = edits.notes;
    }

    if (edits.scheduledDate !== undefined) {
      // Google uses an RFC3339 field but Tasks dates have no time-of-day meaning.
      body.due =
        edits.scheduledDate === null
          ? null
          : `${edits.scheduledDate}T00:00:00.000Z`;
    }

    return body;
  }

  private async getList(listId: string) {
    return listSchema.parse(
      await this.request(`/users/@me/lists/${encodeURIComponent(listId)}`),
    );
  }

  private taskPath(reference: TaskReference): string {
    return `/lists/${encodeURIComponent(reference.listId)}/tasks/${encodeURIComponent(reference.id)}`;
  }

  private toTask(
    task: z.infer<typeof taskSchema>,
    list: z.infer<typeof listSchema>,
  ): GoogleTask {
    return {
      id: task.id,
      listId: list.id,
      listTitle: list.title,
      title: task.title,
      status: task.status,
      etag: task.etag,
      ...(task.notes ? { notes: task.notes } : {}),
      ...(task.due
        ? { scheduledDate: z.iso.date().parse(task.due.slice(0, 10)) }
        : {}),
    };
  }

  private async request(
    path: string,
    init: RequestInit = {},
  ): Promise<unknown> {
    const token = await this.getAccessToken();
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    headers.set('Content-Type', 'application/json');

    let response: Response;

    try {
      // Never retry a mutation automatically: a lost response may still mean it saved.
      response = await this.fetcher(`${apiOrigin}${path}`, {
        ...init,
        headers,
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new GoogleTasksError(
        'Google could not be reached. Refresh before retrying a change.',
        'unavailable',
      );
    }

    if (response.status === 401 || response.status === 403) {
      throw new GoogleTasksError(
        'Google access is unavailable. Reconnect your account and grant Tasks access.',
        'reconnect',
      );
    }

    if (response.status === 412) {
      throw new GoogleTasksError(
        'This task changed elsewhere. Cancel your edit, refresh, and try again.',
        'conflict',
      );
    }

    if (response.status === 404) {
      throw new GoogleTasksError(
        'That task or list is not available in your Google account.',
        'not_found',
      );
    }

    if (!response.ok) {
      throw new GoogleTasksError(
        'Google could not complete the request. Refresh before retrying.',
        'unavailable',
      );
    }

    return response.json();
  }
}
