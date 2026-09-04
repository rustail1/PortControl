export const DEFAULT_HUMAN_FEEL_LEVEL_ID = 'calm_07';

export function resolveDevelopmentLevelId(
  search: string,
  levels: Readonly<Record<string, unknown>>,
  fallbackLevelId = DEFAULT_HUMAN_FEEL_LEVEL_ID,
): string {
  const requested = new URLSearchParams(search).get('level');
  return requested !== null && Object.hasOwn(levels, requested)
    ? requested
    : fallbackLevelId;
}
