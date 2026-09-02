export interface DebugSnapshot {
  readonly sessionState: string | null;
  readonly seed: number | null;
  readonly rngState: readonly number[] | null;
  readonly pressure: number | null;
}

export interface DebugSnapshotProvider {
  getDebugSnapshot(): DebugSnapshot;
}

export const unavailableDebugSnapshot: DebugSnapshot = Object.freeze({
  sessionState: null,
  seed: null,
  rngState: null,
  pressure: null,
});

function formatValue(value: string | number | null): string {
  return value === null ? 'unavailable' : String(value);
}

export function formatDebugSnapshot(snapshot: DebugSnapshot): string {
  const rng =
    snapshot.rngState === null
      ? 'unavailable'
      : `[${snapshot.rngState.join(',')}]`;

  return [
    `session: ${formatValue(snapshot.sessionState)}`,
    `seed: ${formatValue(snapshot.seed)}`,
    `rng: ${rng}`,
    `pressure: ${formatValue(snapshot.pressure)}`,
  ].join('\n');
}

/** Dev-only presentation. The provider retains ownership of every value. */
export class DebugOverlay {
  readonly #provider: DebugSnapshotProvider;
  #element: HTMLPreElement | null = null;
  #animationFrame: number | null = null;

  public constructor(provider: DebugSnapshotProvider) {
    this.#provider = provider;
  }

  public mount(parent: HTMLElement = document.body): void {
    if (this.#element !== null) {
      return;
    }

    const element = document.createElement('pre');
    element.dataset.portControlDebugOverlay = 'true';
    element.setAttribute('aria-hidden', 'true');
    element.style.cssText = [
      'position:fixed',
      'z-index:1000',
      'top:8px',
      'left:8px',
      'margin:0',
      'padding:8px',
      'background:rgba(0,0,0,0.72)',
      'color:#9ef0a4',
      'font:12px/1.35 monospace',
      'pointer-events:none',
      'white-space:pre',
    ].join(';');
    parent.append(element);
    this.#element = element;
    this.refresh();
    this.scheduleRefresh();
  }

  public refresh(): void {
    if (this.#element !== null) {
      this.#element.textContent = formatDebugSnapshot(
        this.#provider.getDebugSnapshot(),
      );
    }
  }

  public destroy(): void {
    if (this.#animationFrame !== null) {
      cancelAnimationFrame(this.#animationFrame);
      this.#animationFrame = null;
    }
    this.#element?.remove();
    this.#element = null;
  }

  private scheduleRefresh(): void {
    this.#animationFrame = requestAnimationFrame(() => {
      this.refresh();
      this.scheduleRefresh();
    });
  }
}
