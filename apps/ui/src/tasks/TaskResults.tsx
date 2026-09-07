import type { Task } from '@tasks/shared';

import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

import { TaskCard } from './TaskCard';

export type ResultsState = 'ready' | 'loading' | 'error';

interface TaskResultsProps {
  tasks: Task[];
  state: ResultsState;
  onUpdate: (task: Task) => Promise<void>;
  onRetry: () => void;
}

export function TaskResults({
  tasks,
  state,
  onUpdate,
  onRetry,
}: TaskResultsProps) {
  if (state === 'loading') {
    return (
      <section
        className="rounded-xl border bg-card px-6 py-8 text-sm"
        role="status"
      >
        <Spinner
          className="mr-3 inline-flex align-middle motion-reduce:animate-none"
          aria-hidden="true"
        />
        Finding your tasks…
      </section>
    );
  }

  if (state === 'error') {
    return (
      <section className="rounded-xl border bg-card px-6 py-8 text-sm">
        <div role="alert">
          <h2 className="font-semibold">Tasks couldn’t be loaded</h2>
          <p className="mt-2 mb-4 text-muted-foreground">
            Please try again in a moment.
          </p>
        </div>
        <Button variant="outline" type="button" onClick={onRetry}>
          Try again
        </Button>
      </section>
    );
  }

  if (tasks.length === 0) {
    return (
      <section className="rounded-xl border bg-card px-6 py-8 text-sm">
        <h2 className="font-semibold">No matching tasks</h2>
        <p className="mt-2 text-muted-foreground">
          Try a different phrase or a wider date range.
        </p>
      </section>
    );
  }

  return (
    <section
      className="overflow-hidden rounded-xl border bg-card"
      aria-label="Task results"
    >
      <header className="flex justify-between border-b px-6 py-4 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">
          {tasks.length === 1 ? '1 task' : `${tasks.length} tasks`}
        </span>
        <span>Google Tasks</span>
      </header>
      <ul className="divide-y">
        {tasks.map((task) => (
          <TaskCard
            key={`${task.listId}:${task.id}`}
            task={task}
            onUpdate={onUpdate}
          />
        ))}
      </ul>
      <footer className="border-t px-6 py-3 text-xs text-muted-foreground">
        {tasks.filter((task) => task.status === 'completed').length} completed
      </footer>
    </section>
  );
}
