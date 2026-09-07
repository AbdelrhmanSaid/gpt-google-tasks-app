import { useRef, useState } from 'react';

import type { Task } from '@tasks/shared';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';

import { TaskEditor } from './TaskEditor';

interface TaskCardProps {
  task: Task;
  onUpdate: (task: Task) => Promise<void>;
}

function formatDate(date: string): string {
  // Calendar dates must not shift a day when the viewer's timezone changes.
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
}

export function TaskCard({ task, onUpdate }: TaskCardProps) {
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const editButton = useRef<HTMLButtonElement>(null);
  const completed = task.status === 'completed';

  function closeEditor() {
    setEditing(false);
    editButton.current?.focus();
  }

  async function saveTask(updated: Task) {
    setPending(true);

    try {
      await onUpdate(updated);
      closeEditor();
    } finally {
      setPending(false);
    }
  }

  async function toggleCompleted() {
    setPending(true);
    setError('');

    try {
      await onUpdate({
        ...task,
        status: completed ? 'needsAction' : 'completed',
      });
    } catch {
      setError('Could not update this task. Try the checkbox again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <li className="px-4 py-5 sm:px-6 sm:py-6">
      <div className="flex items-start gap-3">
        <Checkbox
          className="mt-1 shrink-0"
          checked={completed}
          disabled={pending || editing}
          onCheckedChange={() => void toggleCompleted()}
          aria-label={`${completed ? 'Reopen' : 'Complete'} ${task.title}`}
        />
        <div className="min-w-0 flex-1">
          <h2
            className={cn(
              'text-sm leading-relaxed font-semibold wrap-anywhere',
              completed && 'text-muted-foreground line-through',
            )}
          >
            {task.title}
          </h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{task.listTitle}</span>
            <span aria-hidden="true">·</span>
            {task.scheduledDate ? (
              <time dateTime={task.scheduledDate}>
                {formatDate(task.scheduledDate)}
              </time>
            ) : (
              <span>No date</span>
            )}
            {completed && <span className="text-success">Completed</span>}
          </div>
          {task.notes && (
            <p className="mt-2.5 text-sm whitespace-pre-wrap text-muted-foreground wrap-anywhere">
              {task.notes}
            </p>
          )}
        </div>
        <Button
          ref={editButton}
          variant="ghost"
          size="sm"
          type="button"
          disabled={pending}
          aria-expanded={editing}
          aria-label={`Edit ${task.title}`}
          onClick={() => {
            setError('');
            setEditing(!editing);
          }}
        >
          Edit
        </Button>
      </div>

      {pending && !editing && (
        <p className="mt-2.5 ml-8 text-xs text-muted-foreground" role="status">
          Updating task…
        </p>
      )}
      {error && (
        <p className="mt-3 text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      {editing && (
        <TaskEditor
          task={task}
          pending={pending}
          onSave={saveTask}
          onCancel={closeEditor}
        />
      )}
    </li>
  );
}
