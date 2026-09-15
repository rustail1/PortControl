import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { SpawnDirector } from '../src/spawning/SpawnDirector.ts';
import { ShipCharacteristicsRegistry } from '../src/ships/ShipCharacteristics.ts';
import { ShipModel } from '../src/ships/ShipModel.ts';
import { ShipState } from '../src/ships/ShipState.ts';

const point = Object.freeze({
  id: 'left-mid',
  x: 0,
  y: 500,
  directionDeg: 0,
  weight: 1,
  tags: Object.freeze(['left']),
});

const characteristics = Object.freeze({
  type: 'speedboat',
  speed: 100,
  turnRateDeg: 90,
  collisionRadius: 12,
  unloadStepMs: 100,
  warningRadius: 40,
  cargoCapacity: 1,
  pressureWeight: 1,
  spawnWeight: 1,
  defaultCargoTypes: Object.freeze(['general']),
});

function makeDirector() {
  let nextIdentity = 0;
  return new SpawnDirector({
    config: {
      level: {
        levelId: 'test',
        allowedShips: ['speedboat'],
        shipWeights: { speedboat: 1 },
        cargoTypes: ['general'],
        cargoGeneration: {
          mode: 'single',
          weights: { general: 1 },
          multiCargoChance: 0,
        },
        director: {
          startInterval: 5,
          minimumInterval: 5,
          warningLeadTime: 0.9,
          maxAlive: 1,
          pressureCap: 1,
          jitter: 0,
          wave: {
            burstMin: 1,
            burstMax: 1,
            breathMin: 0,
            breathMax: 0,
          },
        },
        scriptedIntroShip: 'speedboat',
      },
      balance: {
        occupiedDockPressureWeight: 0,
        activeStormCellPressureWeight: 0,
        unsafeSpawnRetryDelayMs: 250,
      },
    },
    spawnPoints: [point],
    characteristics: new ShipCharacteristicsRegistry(new Map([['speedboat', characteristics]])),
    rng: {
      next: () => 0,
      range: (minimum) => minimum,
      getState: () => [1],
      setState: () => {},
    },
    allocateIdentity: () => {
      const current = nextIdentity++;
      return {
        shipId: `ship-${current}`,
        spawnSequence: current,
        logicalSpawnId: `spawn-${current}`,
      };
    },
  });
}

function input({ activeShips = [], simulationTime = 0, owner = () => null } = {}) {
  return {
    simulationTime,
    activeShips,
    occupiedDockCount: 0,
    activeStormCellCount: 0,
    getSpawnPointOwner: owner,
  };
}

function readyFrom(schedule) {
  return {
    transactionId: schedule.command.transactionId,
    spawnPointId: schedule.command.spawnPoint.id,
    spawnPoint: schedule.command.spawnPoint,
    payload: schedule.command.payload,
  };
}

function blockerAtSpawn() {
  return {
    ship: new ShipModel({
      id: 'blocker',
      characteristics,
      position: { x: point.x, y: point.y },
      rotationDeg: 0,
      state: ShipState.Leaving,
      cargo: {},
      route: null,
    }),
  };
}

test('committed incoming warning remains an exact spawn promise when late occupancy changes', () => {
  const director = makeDirector();
  const scheduled = director.step(input());
  assert.equal(scheduled.kind, 'schedule_incoming');
  director.confirmScheduled(scheduled.command.transactionId, 0);

  const resolution = director.resolveReadySpawn(
    readyFrom(scheduled),
    input({
      simulationTime: scheduled.command.leadTimeSeconds,
      activeShips: [blockerAtSpawn()],
      owner: () => scheduled.command.transactionId,
    }),
  );

  assert.equal(resolution.kind, 'approved');
  assert.equal(resolution.command.transactionId, scheduled.command.transactionId);
  assert.equal(resolution.command.spawnPointId, scheduled.command.spawnPoint.id);
});

test('committed incoming warning is not cancelled when maxAlive/pressure closes during lead time', () => {
  const director = makeDirector();
  const scheduled = director.step(input());
  assert.equal(scheduled.kind, 'schedule_incoming');
  director.confirmScheduled(scheduled.command.transactionId, 0);

  const resolution = director.resolveReadySpawn(
    readyFrom(scheduled),
    input({
      simulationTime: scheduled.command.leadTimeSeconds,
      activeShips: [blockerAtSpawn()],
      owner: () => scheduled.command.transactionId,
    }),
  );

  assert.equal(resolution.kind, 'approved');
  assert.equal(director.toSnapshot().unresolved?.transactionId, scheduled.command.transactionId);
});

test('HarborScene does not render a translucent pre-spawn vessel before materialization', () => {
  const source = readFileSync(new URL('../src/scenes/HarborScene.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /for \(const incoming of snapshot\.incoming\)[\s\S]*?setAlpha\(0\.7\)/);
});
