import { ShipState, type ShipState as ShipStateValue } from '../ships/ShipState.ts';

const SELECTION_RING_START_RADIUS_CSS_PX = 22;
const SELECTION_RING_PEAK_RADIUS_CSS_PX = 39;
const SELECTION_RING_END_RADIUS_CSS_PX = 30;
const SELECTION_RING_GROW_MS = 200;
const SELECTION_RING_SETTLE_MS = 250;
const SELECTION_RING_TOTAL_MS =
  SELECTION_RING_GROW_MS + SELECTION_RING_SETTLE_MS;

export interface SelectionPulseSample {
  readonly radiusCssPx: number;
  readonly alpha: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function easeOutCubic(value: number): number {
  const inverse = 1 - clamp01(value);
  return 1 - inverse * inverse * inverse;
}

function easeInOutCubic(value: number): number {
  const t = clamp01(value);
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

export class SelectionPulsePresentation {
  #activeShipId: string | null = null;
  #elapsedMs = SELECTION_RING_TOTAL_MS;
  #restartRadiusCssPx = SELECTION_RING_START_RADIUS_CSS_PX;
  #restartAlpha = 0;

  public get activeShipId(): string | null {
    return this.#activeShipId;
  }

  public begin(shipId: string): void {
    const current = this.sampleFor(shipId);
    this.#restartRadiusCssPx =
      current?.radiusCssPx ?? SELECTION_RING_START_RADIUS_CSS_PX;
    this.#restartAlpha = current?.alpha ?? 0;
    this.#activeShipId = shipId;
    this.#elapsedMs = 0;
  }

  public clear(): void {
    this.#activeShipId = null;
    this.#elapsedMs = SELECTION_RING_TOTAL_MS;
    this.#restartRadiusCssPx = SELECTION_RING_START_RADIUS_CSS_PX;
    this.#restartAlpha = 0;
  }

  public advance(deltaMs: number): void {
    if (this.#activeShipId === null) return;
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) return;
    this.#elapsedMs = Math.min(
      SELECTION_RING_TOTAL_MS,
      this.#elapsedMs + deltaMs,
    );
    if (this.#elapsedMs >= SELECTION_RING_TOTAL_MS) {
      this.#activeShipId = null;
    }
  }

  public sampleFor(shipId: string): SelectionPulseSample | null {
    if (this.#activeShipId !== shipId) {
      return null;
    }

    if (this.#elapsedMs <= SELECTION_RING_GROW_MS) {
      const eased = easeOutCubic(this.#elapsedMs / SELECTION_RING_GROW_MS);
      return {
        radiusCssPx: lerp(
          this.#restartRadiusCssPx,
          SELECTION_RING_PEAK_RADIUS_CSS_PX,
          eased,
        ),
        alpha: lerp(this.#restartAlpha, 1, eased),
      };
    }

    const eased = easeInOutCubic(
      (this.#elapsedMs - SELECTION_RING_GROW_MS) /
        SELECTION_RING_SETTLE_MS,
    );
    return {
      radiusCssPx: lerp(
        SELECTION_RING_PEAK_RADIUS_CSS_PX,
        SELECTION_RING_END_RADIUS_CSS_PX,
        eased,
      ),
      alpha: lerp(1, 0, eased),
    };
  }

  public radiusCssPxFor(shipId: string): number | null {
    return this.sampleFor(shipId)?.radiusCssPx ?? null;
  }
}

const READY_TO_LEAVE_PULSE_GAP_MS = 100;
const READY_TO_LEAVE_DOUBLE_TOTAL_MS =
  SELECTION_RING_TOTAL_MS * 2 + READY_TO_LEAVE_PULSE_GAP_MS;

export interface ReadyToLeavePulseShipState {
  readonly id: string;
  readonly state: ShipStateValue;
}

export class ReadyToLeavePulsePresentation {
  readonly #previousStateByShipId = new Map<string, ShipStateValue>();
  readonly #elapsedByShipId = new Map<string, number>();

  public observe(ships: readonly ReadyToLeavePulseShipState[]): void {
    const alive = new Set<string>();
    for (const ship of ships) {
      alive.add(ship.id);
      const previous = this.#previousStateByShipId.get(ship.id);
      if (
        previous === ShipState.Unloading &&
        ship.state === ShipState.ReadyToLeave
      ) {
        this.#elapsedByShipId.set(ship.id, 0);
      }
      this.#previousStateByShipId.set(ship.id, ship.state);
    }

    for (const shipId of this.#previousStateByShipId.keys()) {
      if (!alive.has(shipId)) {
        this.#previousStateByShipId.delete(shipId);
        this.#elapsedByShipId.delete(shipId);
      }
    }
  }

  public advance(deltaMs: number): void {
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) return;
    for (const [shipId, elapsedMs] of this.#elapsedByShipId) {
      const nextElapsedMs = Math.min(
        READY_TO_LEAVE_DOUBLE_TOTAL_MS,
        elapsedMs + deltaMs,
      );
      if (nextElapsedMs >= READY_TO_LEAVE_DOUBLE_TOTAL_MS) {
        this.#elapsedByShipId.delete(shipId);
      } else {
        this.#elapsedByShipId.set(shipId, nextElapsedMs);
      }
    }
  }

  public sampleFor(shipId: string): SelectionPulseSample | null {
    const elapsedMs = this.#elapsedByShipId.get(shipId);
    if (elapsedMs === undefined) return null;

    if (elapsedMs < SELECTION_RING_TOTAL_MS) {
      return this.#sampleSinglePulse(elapsedMs);
    }

    const secondPulseStartMs =
      SELECTION_RING_TOTAL_MS + READY_TO_LEAVE_PULSE_GAP_MS;
    if (elapsedMs < secondPulseStartMs) {
      return null;
    }

    return this.#sampleSinglePulse(elapsedMs - secondPulseStartMs);
  }

  public clear(): void {
    this.#previousStateByShipId.clear();
    this.#elapsedByShipId.clear();
  }

  #sampleSinglePulse(elapsedMs: number): SelectionPulseSample | null {
    if (elapsedMs >= SELECTION_RING_TOTAL_MS) return null;
    if (elapsedMs <= SELECTION_RING_GROW_MS) {
      const eased = easeOutCubic(elapsedMs / SELECTION_RING_GROW_MS);
      return {
        radiusCssPx: lerp(
          SELECTION_RING_START_RADIUS_CSS_PX,
          SELECTION_RING_PEAK_RADIUS_CSS_PX,
          eased,
        ),
        alpha: lerp(0, 1, eased),
      };
    }

    const eased = easeInOutCubic(
      (elapsedMs - SELECTION_RING_GROW_MS) /
        SELECTION_RING_SETTLE_MS,
    );
    return {
      radiusCssPx: lerp(
        SELECTION_RING_PEAK_RADIUS_CSS_PX,
        SELECTION_RING_END_RADIUS_CSS_PX,
        eased,
      ),
      alpha: lerp(1, 0, eased),
    };
  }
}
