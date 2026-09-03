import type { ConfigBundle } from '../config/types.ts';
import { DockCollection, DockModel, type DockDefinition } from './DockModel.ts';

interface LevelDockBlock {
  readonly blockType: 'dock';
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
  readonly enabled: boolean;
  readonly props: {
    readonly cargoTypes: readonly string[];
    readonly snapRadius: number;
    readonly dockAngle: number;
    readonly helperFlag: boolean;
    readonly visualVariant: string;
  };
}

function isDockBlock(value: unknown): value is LevelDockBlock {
  return typeof value === 'object' && value !== null && (value as { blockType?: unknown }).blockType === 'dock';
}

export function createDocksFromLevel(level: Record<string, unknown>): DockCollection {
  const layout = level.layout as { blocks?: unknown[] };
  const docks = (layout.blocks ?? [])
    .filter(isDockBlock)
    .filter((block) => block.enabled)
    .map((block) => new DockModel({
      id: block.id,
      position: { x: block.x, y: block.y },
      rotationDeg: block.rotation,
      dockAngle: block.props.dockAngle,
      snapRadius: block.props.snapRadius,
      acceptedCargoTypes: block.props.cargoTypes,
      helperFlag: block.props.helperFlag,
      visualVariant: block.props.visualVariant,
    } satisfies DockDefinition));
  return new DockCollection(docks);
}

export function createDocksForValidatedLevel(
  bundle: ConfigBundle,
  levelId: string,
): DockCollection {
  const level = bundle.levels[levelId];
  if (level === undefined) throw new RangeError(`Unknown level: ${levelId}`);
  return createDocksFromLevel(level);
}
