export type DomainEventMap = Record<string, unknown>;
export type DomainEventListener<Event> = (event: Readonly<Event>) => void;
export type Unsubscribe = () => void;

interface PendingEvent<Events extends DomainEventMap> {
  readonly type: keyof Events;
  readonly payload: Events[keyof Events];
}

type UntypedListener = (event: unknown) => void;

/**
 * Instance-owned FIFO queue. Its owner emits during a fixed step and invokes
 * flush at the explicit EventFlush phase; no subsystem is called from here.
 */
export class DomainEventQueue<Events extends DomainEventMap> {
  readonly #listeners = new Map<keyof Events, Set<UntypedListener>>();
  #pending: PendingEvent<Events>[] = [];

  public get pendingCount(): number {
    return this.#pending.length;
  }

  public subscribe<Key extends keyof Events>(
    type: Key,
    listener: DomainEventListener<Events[Key]>,
  ): Unsubscribe {
    let listeners = this.#listeners.get(type);
    if (listeners === undefined) {
      listeners = new Set();
      this.#listeners.set(type, listeners);
    }

    const storedListener = listener as UntypedListener;
    listeners.add(storedListener);

    return () => {
      listeners.delete(storedListener);
    };
  }

  public emit<Key extends keyof Events>(type: Key, payload: Events[Key]): void {
    this.#pending.push({ type, payload });
  }

  /** Delivers the current FIFO batch; newly emitted events wait for next flush. */
  public flush(): void {
    const pending = this.#pending;
    this.#pending = [];

    for (const event of pending) {
      const listeners = this.#listeners.get(event.type);
      if (listeners === undefined) {
        continue;
      }

      for (const listener of [...listeners]) {
        if (listeners.has(listener)) {
          listener(event.payload);
        }
      }
    }
  }
}
