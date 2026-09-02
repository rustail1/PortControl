import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';

const baselineRoot = resolve(
  import.meta.dirname,
  '..',
  '..',
  'Port_Control_Baseline_Source_FINAL_v1.5',
);

function readJsonDirectory(directory, keyForPath) {
  const modules = {};

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      Object.assign(modules, readJsonDirectory(path, keyForPath));
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      modules[keyForPath(path)] = JSON.parse(readFileSync(path, 'utf8'));
    }
  }

  return modules;
}

export function readBaselineSource() {
  const configRoot = join(baselineRoot, 'src', 'config');
  const schemaRoot = join(baselineRoot, 'schemas');

  return {
    configs: readJsonDirectory(configRoot, (path) =>
      relative(configRoot, path).split(sep).join('/'),
    ),
    schemas: readJsonDirectory(schemaRoot, (path) => basename(path)),
  };
}
