import type {
  AdResult,
  AuthResult,
  AuthState,
  FeatureFlags,
  IPlatformAdapter,
  PlatformInitResult,
  RewardedResult,
  SaveResult,
  StoredProfile,
  Unsubscribe,
} from './IPlatformAdapter.ts';

type LocalLifecycleState = 'running' | 'paused';

export class LocalPlatformAdapter implements IPlatformAdapter {
  private readonly pauseCallbacks = new Set<() => void>();
  private readonly resumeCallbacks = new Set<() => void>();
  private lifecycleState: LocalLifecycleState = 'running';
  private storedProfile: StoredProfile | null = null;
  private detachBrowserLifecycle: (() => void) | null = null;
  private gameplayRunning = false;

  async init(): Promise<PlatformInitResult> {
    this.attachBrowserLifecycle();
    return { status: 'ready', mode: 'local' };
  }

  async gameReady(): Promise<void> {}

  gameplayStart(): void { this.gameplayRunning = true; }

  gameplayStop(): void { this.gameplayRunning = false; }

  onPause(cb: () => void): Unsubscribe {
    return this.subscribe(this.pauseCallbacks, cb);
  }

  onResume(cb: () => void): Unsubscribe {
    return this.subscribe(this.resumeCallbacks, cb);
  }

  async showInterstitial(): Promise<AdResult> {
    return { status: 'unavailable' };
  }

  async showRewarded(_placement: string): Promise<RewardedResult> {
    return { status: 'unavailable' };
  }

  async loadProfile(): Promise<StoredProfile | null> {
    return this.storedProfile === null
      ? null
      : structuredClone(this.storedProfile);
  }

  async saveProfile(
    profile: StoredProfile,
    _critical = false,
  ): Promise<SaveResult> {
    this.storedProfile = structuredClone(profile);
    return { status: 'saved', storage: 'local' };
  }

  async getAuthState(): Promise<AuthState> {
    return { status: 'guest' };
  }

  async requestAuth(): Promise<AuthResult> {
    return { status: 'unavailable', authState: { status: 'guest' } };
  }

  async loadRemoteFlags(defaults: FeatureFlags): Promise<FeatureFlags> {
    return structuredClone(defaults);
  }

  track(_name: string, _params?: Record<string, unknown>): void {}

  simulatePause(): void {
    if (this.lifecycleState === 'paused') {
      return;
    }

    this.lifecycleState = 'paused';
    this.emit(this.pauseCallbacks);
  }

  simulateResume(): void {
    if (this.lifecycleState === 'running') {
      return;
    }

    this.lifecycleState = 'running';
    this.emit(this.resumeCallbacks);
  }

  public dispose(): void {
    this.detachBrowserLifecycle?.();
    this.detachBrowserLifecycle = null;
  }

  private attachBrowserLifecycle(): void {
    if (this.detachBrowserLifecycle !== null || typeof document === 'undefined' || typeof window === 'undefined') return;
    const visibility = () => document.hidden ? this.simulatePause() : this.simulateResume();
    const blur = () => this.simulatePause();
    const focus = () => { if (!document.hidden) this.simulateResume(); };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('blur', blur);
    window.addEventListener('focus', focus);
    this.detachBrowserLifecycle = () => {
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('blur', blur);
      window.removeEventListener('focus', focus);
    };
  }

  private subscribe(callbacks: Set<() => void>, cb: () => void): Unsubscribe {
    callbacks.add(cb);
    return () => {
      callbacks.delete(cb);
    };
  }

  private emit(callbacks: ReadonlySet<() => void>): void {
    for (const cb of [...callbacks]) {
      cb();
    }
  }
}
