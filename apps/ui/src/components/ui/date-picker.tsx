import { useState } from 'react';
import { CalendarIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  displayCalendarDate,
  parseCalendarDate,
  serializeCalendarDate,
} from '@/lib/calendarDate';
import { cn } from '@/lib/utils';

interface DatePickerProps {
  id: string;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}

export function DatePicker({
  id,
  value,
  disabled = false,
  onChange,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const selectedDate = parseCalendarDate(value);

  function selectDate(date: Date | undefined) {
    onChange(date ? serializeCalendarDate(date) : '');
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            'w-full justify-start text-left font-normal',
            !value && 'text-muted-foreground',
          )}
        >
          <CalendarIcon aria-hidden="true" />
          {selectedDate ? displayCalendarDate(selectedDate) : 'Pick a date'}
        </Button>
      </PopoverTrigger>

      <PopoverContent
        className="w-auto max-w-[calc(100vw-2rem)] p-0"
        align="start"
        aria-label="Choose scheduled date"
      >
        <Calendar
          mode="single"
          selected={selectedDate}
          defaultMonth={selectedDate ?? new Date()}
          onSelect={selectDate}
          disabled={disabled}
          autoFocus
        />

        {value && (
          <div className="border-t p-2">
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              disabled={disabled}
              onClick={() => selectDate(undefined)}
            >
              Clear date
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
