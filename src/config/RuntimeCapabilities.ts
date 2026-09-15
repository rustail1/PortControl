import type { LevelDefinition } from './LevelDefinition.ts';

export type RuntimeCapability = 'core-routing' | 'current-zone' | 'storm-path' | 'fog-zone' | 'rewind';
export const IMPLEMENTED_RUNTIME_CAPABILITIES: ReadonlySet<RuntimeCapability> = new Set<RuntimeCapability>(['core-routing']);

const capabilityForBlock: Readonly<Record<string, RuntimeCapability | undefined>> = Object.freeze({
  current_zone: 'current-zone', storm_path: 'storm-path', fog_zone: 'fog-zone',
});

export function requiredCapabilities(level: LevelDefinition): readonly RuntimeCapability[] {
  const result = new Set<RuntimeCapability>(['core-routing']);
  for (const block of level.layout.blocks) {
    if (block.enabled === false || block.blockType === undefined) continue;
    const capability = capabilityForBlock[block.blockType];
    if (capability !== undefined) result.add(capability);
  }
  return Object.freeze([...result]);
}

export function missingCapabilities(level: LevelDefinition, implemented: ReadonlySet<RuntimeCapability> = IMPLEMENTED_RUNTIME_CAPABILITIES): readonly RuntimeCapability[] {
  return Object.freeze(requiredCapabilities(level).filter((capability) => !implemented.has(capability)));
}

export function assertLevelSupported(level: LevelDefinition, implemented: ReadonlySet<RuntimeCapability> = IMPLEMENTED_RUNTIME_CAPABILITIES): void {
  const missing = missingCapabilities(level, implemented);
  if (missing.length > 0) throw new Error(`Unsupported level capabilities for ${level.id}: ${missing.join(', ')}`);
}
