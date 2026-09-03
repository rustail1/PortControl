export const SessionState = Object.freeze({
  Active: 'Active',
  Completed: 'Completed',
  Failed: 'Failed',
} as const);

export type SessionState = (typeof SessionState)[keyof typeof SessionState];
