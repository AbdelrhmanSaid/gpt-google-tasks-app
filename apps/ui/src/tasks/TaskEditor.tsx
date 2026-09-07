import { useId, useState } from 'react';
import type { FormEvent } from 'react';

import type { Task } from '@tasks/shared';

import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';

interface TaskEditorProps {
  task: Task;
  pending: boolean;
  onSave: (task: Task) => Promise<void>;
  onCancel: () => void;
}

export function TaskEditor({
  task,
  pending,
  onSave,
  onCancel,
}: TaskEditorProps) {
  const formId = useId();
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes ?? '');
  const [date, setDate] = useState(task.scheduledDate ?? '');
  const [error, setError] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!title.trim()) {
      setError('Give this task a title.');
      return;
    }

    // Remove optional fields first so clearing an input also clears its value.
    const updated = { ...task, title: title.trim() };
    delete updated.notes;
    delete updated.scheduledDate;

    if (notes.trim()) {
      updated.notes = notes.trim();
    }

    if (date) {
      updated.scheduledDate = date;
    }

    setError('');

    try {
      await onSave(updated);
    } catch {
      setError(
        'Could not save your changes. Your edits are still here — try again.',
      );
    }
  }

  return (
    <form
      className="mt-5 sm:ml-8"
      onSubmit={(event) => void handleSubmit(event)}
      aria-label="Edit task"
    >
      <fieldset className="grid min-w-0 gap-2" disabled={pending}>
        <Label htmlFor={`${formId}-title`}>Title</Label>
        <Input
          id={`${formId}-title`}
          value={title}
          maxLength={1024}
          onChange={(event) => setTitle(event.target.value)}
          autoFocus
          required
        />

        <Label className="mt-2" htmlFor={`${formId}-notes`}>
          Notes{' '}
          <span className="font-normal text-muted-foreground">optional</span>
        </Label>
        <Textarea
          id={`${formId}-notes`}
          value={notes}
          maxLength={8192}
          rows={3}
          onChange={(event) => setNotes(event.target.value)}
        />

        <Label className="mt-2" htmlFor={`${formId}-date`}>
          Scheduled date
        </Label>
        <DatePicker
          id={`${formId}-date`}
          value={date}
          onChange={setDate}
          disabled={pending}
        />

        <div className="mt-2 flex flex-wrap gap-2">
          <Button type="submit" disabled={pending}>
            {pending && <Spinner aria-hidden="true" />}
            {pending ? 'Saving…' : 'Save changes'}
          </Button>
          <Button variant="outline" type="button" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </fieldset>

      {error && (
        <p className="mt-3 text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
