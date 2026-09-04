export interface DangerVisualPulseSnapshot {
  readonly shipAId: string;
  readonly shipBId: string;
  readonly remainingSeconds: number;
}

export interface CargoRejectVisualPulseSnapshot {
  readonly shipId: string;
  readonly remainingSeconds: number;
}

interface MutableDangerPulse {
  readonly shipAId: string;
  readonly shipBId: string;
  remainingSeconds: number;
}

function pairKey(shipAId: string, shipBId: string): string {
  return shipAId <= shipBId
    ? `${shipAId}\u0000${shipBId}`
    : `${shipBId}\u0000${shipAId}`;
}

export class PresentationPulseStore {
  readonly #danger = new Map<string, MutableDangerPulse>();
  readonly #cargoReject = new Map<string, number>();

  public refreshDanger(shipAId: string, shipBId: string, ttlSeconds: number): void {
    this.#assertTtl(ttlSeconds);
    const [first, second] = shipAId <= shipBId
      ? [shipAId, shipBId]
      : [shipBId, shipAId];
    this.#danger.set(pairKey(first, second), {
      shipAId: first,
      shipBId: second,
      remainingSeconds: ttlSeconds,
    });
  }

  public refreshCargoReject(shipId: string, ttlSeconds: number): void {
    this.#assertTtl(ttlSeconds);
    this.#cargoReject.set(shipId, ttlSeconds);
  }

  public advance(deltaSeconds: number): void {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
      throw new RangeError('pulse deltaSeconds must be a non-negative finite number');
    }
    for (const [key, pulse] of this.#danger) {
      pulse.remainingSeconds -= deltaSeconds;
      if (pulse.remainingSeconds <= 0) this.#danger.delete(key);
    }
    for (const [shipId, remaining] of this.#cargoReject) {
      const next = remaining - deltaSeconds;
      if (next <= 0) this.#cargoReject.delete(shipId);
      else this.#cargoReject.set(shipId, next);
    }
  }

  public forgetShip(shipId: string): void {
    this.#cargoReject.delete(shipId);
    for (const [key, pulse] of this.#danger) {
      if (pulse.shipAId === shipId || pulse.shipBId === shipId) {
        this.#danger.delete(key);
      }
    }
  }

  public clear(): void {
    this.#danger.clear();
    this.#cargoReject.clear();
  }

  public dangerSnapshot(): readonly DangerVisualPulseSnapshot[] {
    return Object.freeze(
      [...this.#danger.values()]
        .sort((left, right) => pairKey(left.shipAId, left.shipBId).localeCompare(pairKey(right.shipAId, right.shipBId)))
        .map((pulse) => Object.freeze({ ...pulse })),
    );
  }

  public cargoRejectSnapshot(): readonly CargoRejectVisualPulseSnapshot[] {
    return Object.freeze(
      [...this.#cargoReject.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([shipId, remainingSeconds]) => Object.freeze({ shipId, remainingSeconds })),
    );
  }

  #assertTtl(ttlSeconds: number): void {
    if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
      throw new RangeError('pulse ttlSeconds must be a positive finite number');
    }
  }
}
