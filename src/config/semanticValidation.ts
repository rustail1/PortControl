import {
  validatePolygon,
  validateRectangleExtents,
} from './geometryValidation.ts';

type Dictionary<T = unknown> = Record<string, T>;
type Point = [number, number];

interface Block {
  blockType: string;
  id: string;
  x: number;
  y: number;
  enabled?: boolean;
  props: Dictionary;
}

interface Level {
  id: string;
  order: number;
  portId: string;
  allowedShips: string[];
  cargoTypes: string[];
  shipWeights?: Dictionary<number>;
  cargoGeneration: { weights: Dictionary<number> };
  director: {
    startInterval: number;
    minimumInterval: number;
    wave: {
      burstMin: number;
      burstMax: number;
      breathMin: number;
      breathMax: number;
    };
  };
  layout: { blocks: Block[] };
  starConditions: Array<{ shipId?: string; shipIds?: string[] }>;
}

interface BlockDescriptor {
  geometryMode: 'pointLike' | 'polygonLike' | 'pathLike' | 'rectLike';
}

function as<T>(configs: Readonly<Record<string, unknown>>, path: string): T {
  return configs[path] as T;
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function positiveSum(values: Dictionary<number>): boolean {
  return Object.values(values).reduce((sum, value) => sum + value, 0) > 0;
}

function resolveMachineReference(
  configs: Readonly<Record<string, unknown>>,
  reference: string,
): unknown {
  const [configId, ...path] = reference.split('.');
  let current: unknown = configs[`${configId}.json`];
  for (const segment of path) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Dictionary)[segment];
  }
  return current;
}

function validateMachineContracts(
  configs: Readonly<Record<string, unknown>>,
  levels: ReadonlyMap<string, Level>,
  issues: string[],
): void {
  const platform = as<{ releaseFeatures: Dictionary; auth: Dictionary }>(
    configs,
    'platform.json',
  );
  const releaseFeatures = platform.releaseFeatures;
  if (releaseFeatures['campaignLevelCount'] !== levels.size) {
    issues.push(
      `platform: campaignLevelCount ${String(releaseFeatures['campaignLevelCount'])} does not match bundled levels ${levels.size}`,
    );
  }

  const screenFlow = as<{
    firstLaunch: { menuAction: string; target: string };
    screens: Dictionary<Dictionary>;
    transitions: Array<Dictionary<string>>;
  }>(configs, 'screen_flow.json');
  const screens = screenFlow.screens;
  const unlockAfterLevel = platform.auth['unlockAfterLevel'] as string;
  if (!levels.has(unlockAfterLevel)) {
    issues.push(`platform: unknown auth unlock level ${unlockAfterLevel}`);
  }
  for (const placement of platform.auth['placements'] as string[]) {
    if (!screens[placement]) {
      issues.push(`platform: unknown auth placement screen ${placement}`);
    }
  }

  const [firstLaunchScreen, firstLaunchLevel] = screenFlow.firstLaunch.target.split(':');
  if (!screens[firstLaunchScreen]) {
    issues.push(`screen_flow: firstLaunch references unknown screen ${firstLaunchScreen}`);
  }
  if (!levels.has(firstLaunchLevel)) {
    issues.push(`screen_flow: firstLaunch references unknown level ${firstLaunchLevel}`);
  }
  if (
    !screenFlow.transitions.some(
      (transition) =>
        transition['from'] === 'menu' &&
        transition['action'] === screenFlow.firstLaunch.menuAction,
    )
  ) {
    issues.push(
      `screen_flow: firstLaunch action ${screenFlow.firstLaunch.menuAction} has no menu transition`,
    );
  }
  for (const [screenId, screen] of Object.entries(screens)) {
    const owner = screen['owner'];
    if (typeof owner !== 'string') {
      continue;
    }
    for (const ownerScreen of owner.split('_or_')) {
      if (!screens[ownerScreen]) {
        issues.push(
          `screen_flow: ${screenId} references unknown owner screen ${ownerScreen}`,
        );
      }
    }
  }
  for (const transition of screenFlow.transitions) {
    const from = transition['from'];
    const action = transition['action'];
    const to = transition['to'];
    if (!screens[from]) {
      issues.push(
        `screen_flow: transition ${from}/${action} references unknown from screen ${from}`,
      );
    }
    if (!screens[to]) {
      issues.push(
        `screen_flow: transition ${from}/${action} references unknown to screen ${to}`,
      );
    }
  }

  const analytics = as<{
    parameters: Dictionary;
    events: Dictionary<{ required: string[]; optional: string[] }>;
  }>(configs, 'analytics_events.json');
  for (const [eventId, event] of Object.entries(analytics.events)) {
    for (const parameter of [...event.required, ...event.optional]) {
      if (!analytics.parameters[parameter]) {
        issues.push(
          `analytics: ${eventId} references unknown parameter ${parameter}`,
        );
      }
    }
    for (const parameter of event.required) {
      if (event.optional.includes(parameter)) {
        issues.push(`analytics: ${eventId} parameter ${parameter} is both required and optional`);
      }
    }
  }

  const audio = as<{
    formatPreference: string[];
    musicIntensity: { source: string; crossfadeMsSource: string };
    assets: Dictionary<{ path: string }>;
  }>(configs, 'audio.json');
  for (const reference of [
    audio.musicIntensity.source,
    audio.musicIntensity.crossfadeMsSource,
  ]) {
    if (resolveMachineReference(configs, reference) === undefined) {
      issues.push(`audio: unknown reference ${reference}`);
    }
  }
  for (const [audioId, asset] of Object.entries(audio.assets)) {
    const extension = asset.path.split('.').at(-1);
    if (extension === undefined || !audio.formatPreference.includes(extension)) {
      issues.push(
        `audio: ${audioId} path extension ${String(extension)} is not in formatPreference`,
      );
    }
  }
}

export function validateSemanticConfig(
  configs: Readonly<Record<string, unknown>>,
): string[] {
  const issues: string[] = [];
  const levelEntries = Object.entries(configs).filter(([path]) =>
    /^levels\/[^/]+\.json$/.test(path),
  ) as Array<[string, Level]>;
  const levels = new Map<string, Level>();

  for (const [path, level] of levelEntries) {
    if (levels.has(level.id)) {
      issues.push(`${path}: duplicate level ID ${level.id}`);
    }
    levels.set(level.id, level);
  }

  const index = as<{
    levels: Array<{ id: string; order: number; file: string }>;
  }>(configs, 'levels.index.json');
  const indexIds = index.levels.map((entry) => entry.id);
  const levelIds = [...levels.keys()];
  if (
    new Set(indexIds).size !== indexIds.length ||
    !sameSet(indexIds, levelIds)
  ) {
    issues.push('levels.index mismatch/duplicates');
  }
  for (const entry of index.levels) {
    if (!configs[entry.file]) {
      issues.push(`levels.index missing file ${entry.file}`);
    }
  }

  const sortedOrders = [...levels.values()]
    .map((level) => level.order)
    .sort((left, right) => left - right);
  if (sortedOrders.some((order, indexPosition) => order !== indexPosition + 1)) {
    issues.push('level order must be contiguous from 1');
  }

  const ru = as<{ strings: Dictionary<string> }>(
    configs,
    'localization/ru.json',
  ).strings;
  const en = as<{ strings: Dictionary<string> }>(
    configs,
    'localization/en.json',
  ).strings;
  const requiredKeys = as<{ keys: string[] }>(
    configs,
    'localization.required_keys.json',
  ).keys;
  if (
    !sameSet(Object.keys(ru), Object.keys(en)) ||
    !sameSet(Object.keys(ru), requiredKeys)
  ) {
    issues.push('localization key parity mismatch');
  }
  for (const key of requiredKeys) {
    if (!ru[key]?.trim() || !en[key]?.trim()) {
      issues.push(`localization empty key ${key}`);
    }
  }

  const ships = as<{ ships: Dictionary }>(configs, 'ships.json').ships;
  const ports = as<{ ports: Dictionary<Dictionary> }>(configs, 'ports.json').ports;
  const upgrades = as<{ upgrades: Dictionary<Dictionary> }>(
    configs,
    'upgrades.json',
  ).upgrades;
  const perks = as<{ perks: Dictionary<Dictionary> }>(configs, 'perks.json').perks;
  const assets = as<{ assets: Dictionary }>(configs, 'assets.catalog.json').assets;
  const blockRegistry = as<{ blocks: Dictionary<BlockDescriptor> }>(
    configs,
    'editor_blocks.json',
  ).blocks;
  const [worldWidth, worldHeight] = as<{
    simulation: { logicalWorld: [number, number] };
  }>(configs, 'balance.json').simulation.logicalWorld;
  const usedBlockTypes = new Set<string>();

  validateMachineContracts(configs, levels, issues);

  for (const level of levels.values()) {
    if (!ports[level.portId]) {
      issues.push(`${level.id}: unknown port ${level.portId}`);
    }
    if (level.director.startInterval < level.director.minimumInterval) {
      issues.push(`${level.id}: startInterval < minimumInterval`);
    }
    if (level.director.wave.burstMax < level.director.wave.burstMin) {
      issues.push(`${level.id}: burstMax < burstMin`);
    }
    if (level.director.wave.breathMax < level.director.wave.breathMin) {
      issues.push(`${level.id}: breathMax < breathMin`);
    }
    if (level.shipWeights && !positiveSum(level.shipWeights)) {
      issues.push(`${level.id}: shipWeights sum <= 0`);
    }
    if (!positiveSum(level.cargoGeneration.weights)) {
      issues.push(`${level.id}: cargo weights sum <= 0`);
    }

    const blockIds = level.layout.blocks.map((block) => block.id);
    if (new Set(blockIds).size !== blockIds.length) {
      issues.push(`${level.id}: duplicate block IDs`);
    }

    const docks: Block[] = [];
    for (const block of level.layout.blocks) {
      const label = `${level.id}:${block.id}`;
      const descriptor = blockRegistry[block.blockType];
      usedBlockTypes.add(block.blockType);
      if (!descriptor) {
        issues.push(`${label}: editor registry missing block type ${block.blockType}`);
        continue;
      }
      if (block.blockType === 'dock') {
        docks.push(block);
      }
      const assetKey = block.props['assetKey'];
      const visualVariant = block.props['visualVariant'];
      if (typeof assetKey === 'string' && !assets[assetKey]) {
        issues.push(`${label}: missing assetKey ${assetKey}`);
      }
      if (typeof visualVariant === 'string' && !assets[visualVariant]) {
        issues.push(`${label}: missing visualVariant ${visualVariant}`);
      }

      if (descriptor.geometryMode === 'polygonLike') {
        issues.push(
          ...validatePolygon(
            label,
            block.x,
            block.y,
            block.props['points'] as Point[],
          ),
        );
      } else if (descriptor.geometryMode === 'pathLike') {
        const firstWaypoint = (block.props['waypoints'] as Point[])[0];
        if (
          firstWaypoint !== undefined &&
          (block.x !== firstWaypoint[0] || block.y !== firstWaypoint[1])
        ) {
          issues.push(`${label}: path x/y != first waypoint`);
        }
      } else if (descriptor.geometryMode === 'rectLike') {
        issues.push(
          ...validateRectangleExtents(
            label,
            block.x,
            block.y,
            block.props['width'] as number,
            block.props['height'] as number,
            worldWidth,
            worldHeight,
          ),
        );
      }
    }

    for (const shipId of level.allowedShips) {
      if (!ships[shipId]) {
        issues.push(`${level.id}: unknown ship ${shipId}`);
      }
    }
    for (const cargoType of level.cargoTypes) {
      const accepted = docks.some(
        (dock) =>
          dock.enabled !== false &&
          (dock.props['cargoTypes'] as string[]).includes(cargoType),
      );
      if (!accepted) {
        issues.push(`${level.id}: no dock accepts ${cargoType}`);
      }
    }
    for (const condition of level.starConditions) {
      if (condition.shipId && !level.allowedShips.includes(condition.shipId)) {
        issues.push(`${level.id}: star shipId not allowed`);
      }
      for (const shipId of condition.shipIds ?? []) {
        if (!level.allowedShips.includes(shipId)) {
          issues.push(`${level.id}: star shipIds contains non-allowed ship`);
        }
      }
    }
  }

  for (const blockType of usedBlockTypes) {
    if (!blockRegistry[blockType]) {
      issues.push(`editor registry missing ${blockType}`);
    }
  }

  for (const [portId, port] of Object.entries(ports)) {
    const displayNameKey = port['displayNameKey'] as string;
    const assetBundleKey = port['assetBundleKey'] as string;
    if (!ru[displayNameKey]) {
      issues.push(`${portId}: missing localization ${displayNameKey}`);
    }
    if (!assets[assetBundleKey]) {
      issues.push(`${portId}: missing asset bundle ${assetBundleKey}`);
    }
    for (const upgradeId of port['localUpgrades'] as string[]) {
      if (!upgrades[upgradeId]) {
        issues.push(`${portId}: unknown upgrade ${upgradeId}`);
      }
    }
    for (const pool of port['chapterPerkPools'] as string[][]) {
      for (const perkId of pool) {
        if (!perks[perkId]) {
          issues.push(`${portId}: unknown perk ${perkId}`);
        }
      }
    }
    const levelGates = (port['levelGates'] ?? {}) as Dictionary<string[]>;
    for (const [levelId, requiredUpgrades] of Object.entries(levelGates)) {
      for (const upgradeId of requiredUpgrades) {
        const upgrade = upgrades[upgradeId];
        if (!upgrade) {
          issues.push(`${portId}:${levelId}: unknown upgrade ${upgradeId}`);
        } else if (
          upgrade['family'] === 'access' &&
          upgrade['applyPortMultiplier'] === true
        ) {
          issues.push(
            `${portId}:${levelId}: mandatory access gate ${upgradeId} must be fixed-price/no multiplier`,
          );
        }
      }
    }
  }

  for (const [upgradeId, upgrade] of Object.entries(upgrades)) {
    const maxLevel = upgrade['maxLevel'] as number;
    const baseCosts = upgrade['baseCosts'] as number[];
    if (baseCosts.length !== maxLevel) {
      issues.push(`${upgradeId}: baseCosts length != maxLevel`);
    }
    const values = (upgrade['effect'] as Dictionary)['values'];
    if (
      Array.isArray(values) &&
      values.length !== 1 &&
      values.length !== maxLevel
    ) {
      issues.push(`${upgradeId}: effect values length mismatch`);
    }
    for (const key of [upgrade['nameKey'], upgrade['descKey']] as string[]) {
      if (!ru[key]) {
        issues.push(`${upgradeId}: missing localization ${key}`);
      }
    }
  }

  for (const [perkId, perk] of Object.entries(perks)) {
    for (const key of [perk['nameKey'], perk['descKey']] as string[]) {
      if (!ru[key]) {
        issues.push(`${perkId}: missing localization ${key}`);
      }
    }
    const compatibility = (perk['compatibility'] ?? {}) as Dictionary;
    const requiredUpgrade = compatibility['requiresUpgradeNotOwned'];
    if (typeof requiredUpgrade === 'string' && !upgrades[requiredUpgrade]) {
      issues.push(`${perkId}: unknown compatibility upgrade ${requiredUpgrade}`);
    }
  }

  return issues;
}
