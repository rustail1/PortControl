export const CONFIG_SCHEMA_ASSIGNMENTS = [
  ['ships.json', 'ships.schema.json'],
  ['balance.json', 'balance.schema.json'],
  ['ports.json', 'ports.schema.json'],
  ['challenges.json', 'challenges.schema.json'],
  ['events.json', 'events.schema.json'],
  ['upgrades.json', 'upgrades.schema.json'],
  ['perks.json', 'perks.schema.json'],
  ['assets.catalog.json', 'assets.schema.json'],
  ['audio.json', 'audio.schema.json'],
  ['editor_blocks.json', 'editor_blocks.schema.json'],
  ['modes.json', 'modes.schema.json'],
  ['meta_layouts.json', 'meta_layouts.schema.json'],
  ['platform.json', 'platform.schema.json'],
  ['screen_flow.json', 'screen_flow.schema.json'],
  ['analytics_events.json', 'analytics_events.schema.json'],
  ['profile.default.json', 'profile.schema.json'],
  ['localization/ru.json', 'localization.schema.json'],
  ['localization/en.json', 'localization.schema.json'],
  ['localization.required_keys.json', 'localization_keys.schema.json'],
  ['levels.semantic_manifest.json', 'semantic_manifest.schema.json'],
] as const;

export const LEVEL_SCHEMA = 'level.schema.json';
export const LEVEL_INDEX = 'levels.index.json';

export const EXPECTED_CONFIG_NAMES = new Set<string>(
  CONFIG_SCHEMA_ASSIGNMENTS.map(([config]) => config),
);

export const EXPECTED_SCHEMA_NAMES = new Set([
  ...CONFIG_SCHEMA_ASSIGNMENTS.map(([, schema]) => schema),
  LEVEL_SCHEMA,
]);
