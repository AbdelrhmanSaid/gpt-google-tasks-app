import { randomUUID } from 'node:crypto';

import type { DemoTask, TaskSnapshot } from '@tasks/shared';

import { sampleTasks } from './sampleTasks.js';

const sessionLifetimeMs = 60 * 60 * 1000;
const maxSessions = 100;
const maxTasksPerSession = 200;

interface DemoSession {
  expiresAt: number;
  tasks: DemoTask[];
}

export interface TaskEdits {
  title?: string;
  notes?: string | null;
  scheduledDate?: string | null;
}

export class DemoError extends Error {}

// Demo sessions are temporary buckets of fake data, not authenticated users.
// Google access must replace this with credentials resolved from OAuth identity.
export class DemoStore {
  private readonly sessions = new Map<string, DemoSession>();

  start(): TaskSnapshot {
    for (const [id, session] of this.sessions) {
      if (session.expiresAt <= Date.now()) {
        this.sessions.delete(id);
      }
    }

    if (this.sessions.size >= maxSessions) {
      throw new DemoError(
        'The demo is full. Try again after a session expires.',
      );
    }

    const id = randomUUID();

    this.sessions.set(id, {
      expiresAt: Date.now() + sessionLifetimeMs,
      tasks: structuredClone(sampleTasks),
    });

    return this.snapshot(id);
  }

  snapshot(id: string, taskIds?: string[]): TaskSnapshot {
    const session = this.getSession(id);
    const tasks =
      taskIds === undefined
        ? session.tasks
        : taskIds.map((taskId) => this.getTask(session, taskId));

    return {
      sampleData: true,
      demoSessionId: id,
      tasks: structuredClone(tasks),
    };
  }

  search(id: string, query: string, status?: DemoTask['status']): TaskSnapshot {
    const result = this.snapshot(id);
    const phrase = query.trim().toLocaleLowerCase();

    result.tasks = result.tasks.filter((task) => {
      const text = `${task.title}\n${task.notes ?? ''}`.toLocaleLowerCase();

      return (
        text.includes(phrase) &&
        (status === undefined || task.status === status)
      );
    });

    return result;
  }

  create(id: string, title: string, edits: TaskEdits): TaskSnapshot {
    const session = this.getSession(id);

    if (session.tasks.length >= maxTasksPerSession) {
      throw new DemoError('This demo session has reached its task limit.');
    }

    const task: DemoTask = {
      id: randomUUID(),
      listId: 'work',
      listTitle: 'Work',
      title,
      status: 'needsAction',
      revision: 1,
    };

    this.applyEdits(task, edits);
    session.tasks.push(task);

    return this.snapshot(id, [task.id]);
  }

  update(
    id: string,
    taskId: string,
    revision: number,
    edits: TaskEdits,
  ): TaskSnapshot {
    const task = this.getTask(this.getSession(id), taskId);

    this.checkRevision(task, revision);
    this.applyEdits(task, edits);
    task.revision += 1;

    return this.snapshot(id, [taskId]);
  }

  setCompleted(
    id: string,
    taskId: string,
    revision: number,
    completed: boolean,
  ): TaskSnapshot {
    const task = this.getTask(this.getSession(id), taskId);

    this.checkRevision(task, revision);
    task.status = completed ? 'completed' : 'needsAction';
    task.revision += 1;

    return this.snapshot(id, [taskId]);
  }

  private getSession(id: string): DemoSession {
    const session = this.sessions.get(id);

    if (!session || session.expiresAt <= Date.now()) {
      this.sessions.delete(id);
      throw new DemoError(
        'Demo session expired or unknown. Call start_demo to begin again.',
      );
    }

    return session;
  }

  private getTask(session: DemoSession, taskId: string): DemoTask {
    const task = session.tasks.find((candidate) => candidate.id === taskId);

    if (!task) {
      throw new DemoError('Task not found in this demo session. Search again.');
    }

    return task;
  }

  private checkRevision(task: DemoTask, revision: number): void {
    if (task.revision !== revision) {
      throw new DemoError(
        'This task changed since it was displayed. Refresh the tasks before retrying.',
      );
    }
  }

  private applyEdits(task: DemoTask, edits: TaskEdits): void {
    if (edits.title !== undefined) {
      task.title = edits.title;
    }

    for (const field of ['notes', 'scheduledDate'] as const) {
      const value = edits[field];

      if (value === null || value === '') {
        delete task[field];
      } else if (value !== undefined) {
        task[field] = value;
      }
    }
  }
}
