/** Use local calendar days for the picker; UTC conversion can shift the date. */
export function parseCalendarDate(value: string): Date | undefined {
  if (!value) {
    return undefined;
  }

  return new Date(`${value}T12:00:00`);
}

export function serializeCalendarDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

export function displayCalendarDate(date: Date): string {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}
