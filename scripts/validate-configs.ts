import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';

import type { ConfigSource } from '../src/config/types.ts';
import { validateConfigSource } from '../src/config/validateConfigSource.ts';

const projectRoot = resolve(import.meta.dirname, '..');
const baselineRoot = join(
  projectRoot,
  'Port_Control_Baseline_Source_FINAL_v1.5',
);

function readJsonDirectory(
  directory: string,
  keyForPath: (path: string) => string,
): Record<string, unknown> {
  const documents: Record<string, unknown> = {};
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      Object.assign(documents, readJsonDirectory(path, keyForPath));
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      documents[keyForPath(path)] = JSON.parse(readFileSync(path, 'utf8'));
    }
  }
  return documents;
}

const configRoot = join(baselineRoot, 'src', 'config');
const schemaRoot = join(baselineRoot, 'schemas');
const source: ConfigSource = {
  configs: readJsonDirectory(configRoot, (path) =>
    relative(configRoot, path).split(sep).join('/'),
  ),
  schemas: readJsonDirectory(schemaRoot, (path) => basename(path)),
};

const bundle = validateConfigSource(source);
process.stdout.write(
  `Config validation: PASS (${Object.keys(source.schemas).length} schemas, ${Object.keys(bundle.levels).length} levels)\n`,
);
