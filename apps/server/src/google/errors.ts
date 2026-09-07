export class GoogleTasksError extends Error {
  constructor(
    message: string,
    public readonly code:
      'reconnect' | 'conflict' | 'not_found' | 'unavailable' | 'invalid',
  ) {
    super(message);
    this.name = 'GoogleTasksError';
  }
}
