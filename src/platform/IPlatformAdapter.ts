export type Unsubscribe = () => void;

export type PlatformInitResult =
  | { readonly status: 'ready'; readonly mode: 'local' | 'remote' }
  | { readonly status: 'error'; readonly errorCode: string };

export type AdResult =
  | { readonly status: 'completed' | 'cancelled' | 'unavailable' }
  | { readonly status: 'error'; readonly errorCode: string };

export type RewardedResult =
  | { readonly status: 'rewarded' | 'cancelled' | 'unavailable' }
  | { readonly status: 'error'; readonly errorCode: string };

export type StoredProfile = Record<string, unknown>;

export type SaveResult =
  | { readonly status: 'saved'; readonly storage: 'local' | 'cloud' }
  | { readonly status: 'failed'; readonly errorCode: string };

export type AuthState =
  | { readonly status: 'guest' }
  | { readonly status: 'authorized'; readonly playerId: string };

export type AuthResult =
  | { readonly status: 'authorized'; readonly authState: AuthState }
  | {
      readonly status: 'cancelled' | 'unavailable';
      readonly authState: AuthState;
    }
  | {
      readonly status: 'error';
      readonly errorCode: string;
      readonly authState: AuthState;
    };

export type FeatureFlagValue = boolean | number | string;
export type FeatureFlags = Readonly<Record<string, FeatureFlagValue>>;

export interface IPlatformAdapter {
  init(): Promise<PlatformInitResult>;
  gameReady(): Promise<void>;
  gameplayStart(): void;
  gameplayStop(): void;
  onPause(cb: () => void): Unsubscribe;
  onResume(cb: () => void): Unsubscribe;
  showInterstitial(): Promise<AdResult>;
  showRewarded(placement: string): Promise<RewardedResult>;
  loadProfile(): Promise<StoredProfile | null>;
  saveProfile(profile: StoredProfile, critical?: boolean): Promise<SaveResult>;
  getAuthState(): Promise<AuthState>;
  requestAuth(): Promise<AuthResult>;
  loadRemoteFlags(defaults: FeatureFlags): Promise<FeatureFlags>;
  track(name: string, params?: Record<string, unknown>): void;
}
