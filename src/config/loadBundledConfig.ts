import type { ConfigSource } from './types.ts';
import { validateConfigSource } from './validateConfigSource.ts';

const configModules = import.meta.glob(
  '../../Port_Control_Baseline_Source_FINAL_v1.5/src/config/**/*.json',
  { eager: true, import: 'default' },
);
const schemaModules = import.meta.glob(
  '../../Port_Control_Baseline_Source_FINAL_v1.5/schemas/*.json',
  { eager: true, import: 'default' },
);

function relativeModules(
  modules: Record<string, unknown>,
  marker: string,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(modules).map(([path, document]) => {
      const markerIndex = path.indexOf(marker);
      if (markerIndex < 0) {
        throw new Error(`Bundled config path does not contain ${marker}: ${path}`);
      }
      return [path.slice(markerIndex + marker.length), document];
    }),
  );
}

export function loadBundledConfig() {
  const source: ConfigSource = {
    configs: relativeModules(configModules, '/src/config/'),
    schemas: relativeModules(schemaModules, '/schemas/'),
  };
  return validateConfigSource(source);
}
