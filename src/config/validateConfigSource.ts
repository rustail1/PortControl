import { validateSchemas } from './schemaValidation.ts';
import { validateSemanticConfig } from './semanticValidation.ts';
import type { ConfigBundle, ConfigSource } from './types.ts';

export class ConfigValidationError extends Error {
  public readonly issues: readonly string[];

  public constructor(issues: readonly string[]) {
    super(`Config validation failed:\n${issues.map((issue) => `- ${issue}`).join('\n')}`);
    this.name = 'ConfigValidationError';
    this.issues = [...issues];
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

export function validateConfigSource(source: ConfigSource): ConfigBundle {
  const schemaIssues = validateSchemas(source);
  if (schemaIssues.length > 0) {
    throw new ConfigValidationError(schemaIssues);
  }

  const semanticIssues = validateSemanticConfig(source.configs);
  if (semanticIssues.length > 0) {
    throw new ConfigValidationError(semanticIssues);
  }

  const levels: Record<string, Record<string, unknown>> = {};
  const configs: Record<string, Record<string, unknown>> = {};
  for (const [path, document] of Object.entries(source.configs)) {
    const object = asObject(document);
    if (/^levels\/[^/]+\.json$/.test(path)) {
      levels[object['id'] as string] = object;
    } else {
      configs[path] = object;
    }
  }

  return Object.freeze({
    configs: Object.freeze(configs),
    levels: Object.freeze(levels),
  });
}
