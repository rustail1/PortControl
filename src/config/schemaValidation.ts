import Ajv2020, { type AnySchema, type ErrorObject } from 'ajv/dist/2020.js';

import {
  CONFIG_SCHEMA_ASSIGNMENTS,
  EXPECTED_CONFIG_NAMES,
  EXPECTED_SCHEMA_NAMES,
  LEVEL_INDEX,
  LEVEL_SCHEMA,
} from './schemaManifest.ts';
import type { ConfigSource } from './types.ts';

function describeError(error: ErrorObject): string {
  const location = error.instancePath || '/';
  return `${location} ${error.message ?? 'is invalid'}`;
}

export function validateSchemas(source: ConfigSource): string[] {
  const issues: string[] = [];
  const actualSchemas = new Set(Object.keys(source.schemas));

  if (source.configs[LEVEL_INDEX] === undefined) {
    issues.push(`${LEVEL_INDEX}: missing bundled config`);
  }
  for (const configName of Object.keys(source.configs)) {
    const isLevel = /^levels\/[^/]+\.json$/.test(configName);
    if (
      configName !== LEVEL_INDEX &&
      !isLevel &&
      !EXPECTED_CONFIG_NAMES.has(configName)
    ) {
      issues.push(`${configName}: no schema assignment`);
    }
  }

  for (const schemaName of EXPECTED_SCHEMA_NAMES) {
    if (!actualSchemas.has(schemaName)) {
      issues.push(`${schemaName}: missing schema`);
    }
  }

  for (const schemaName of actualSchemas) {
    if (!EXPECTED_SCHEMA_NAMES.has(schemaName)) {
      issues.push(`${schemaName}: schema is not assigned to a bundled config`);
    }
  }

  if (issues.length > 0) {
    return issues;
  }

  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validators = new Map<string, ReturnType<typeof ajv.compile>>();

  for (const schemaName of EXPECTED_SCHEMA_NAMES) {
    try {
      validators.set(
        schemaName,
        ajv.compile(source.schemas[schemaName] as AnySchema),
      );
    } catch (error) {
      issues.push(`${schemaName}: schema compilation failed: ${String(error)}`);
    }
  }

  if (issues.length > 0) {
    return issues;
  }

  const validateDocument = (
    documentName: string,
    schemaName: string,
    document: unknown,
  ): void => {
    if (document === undefined) {
      issues.push(`${documentName}: missing bundled config`);
      return;
    }

    const validate = validators.get(schemaName);
    if (validate === undefined) {
      issues.push(`${schemaName}: validator is unavailable`);
      return;
    }

    if (!validate(document)) {
      for (const error of validate.errors ?? []) {
        issues.push(`${documentName}: schema ${describeError(error)}`);
      }
    }
  };

  for (const [documentName, schemaName] of CONFIG_SCHEMA_ASSIGNMENTS) {
    validateDocument(documentName, schemaName, source.configs[documentName]);
  }

  for (const [documentName, document] of Object.entries(source.configs)) {
    if (documentName.startsWith('levels/') && documentName.endsWith('.json')) {
      validateDocument(documentName, LEVEL_SCHEMA, document);
    }
  }

  return issues;
}
