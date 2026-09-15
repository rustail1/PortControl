import type { TerminalCollision } from '../collision/CollisionSystem.ts';

export interface GroundingTerminalCandidate {
  readonly shipId: string;
  readonly failReason: 'grounding';
  readonly details?: Readonly<Record<string, unknown>>;
}

export type TerminalFailureCandidate = TerminalCollision | GroundingTerminalCandidate;

export function chooseTerminalFailure(input: {
  readonly collision: TerminalCollision | null;
  readonly grounding: GroundingTerminalCandidate | null;
}): TerminalFailureCandidate | null {
  return input.collision ?? input.grounding ?? null;
}
