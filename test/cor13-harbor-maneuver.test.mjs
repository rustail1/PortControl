import assert from 'node:assert/strict';
import test from 'node:test';

import { DockCollection, DockModel } from '../src/docks/DockModel.ts';
import { DockSystem } from '../src/docks/DockSystem.ts';
import { DockingController, deriveDockLane } from '../src/docks/DockingController.ts';
import { DepartureCoordinator } from '../src/docks/DepartureCoordinator.ts';
import { HarborManeuverMotor } from '../src/docks/HarborManeuverMotor.ts';
import { NavigationValidator } from '../src/routes/NavigationValidator.ts';
import { RouteCommitService } from '../src/routes/RouteCommitService.ts';
import { ShipModel } from '../src/ships/ShipModel.ts';
import { ShipMotor } from '../src/ships/ShipMotor.ts';
import { ShipRoute } from '../src/ships/ShipRoute.ts';
import { ShipState } from '../src/ships/ShipState.ts';

const DOCKING_CONFIG = Object.freeze({
    reservationTieBreak: 'distance_then_spawn_sequence',
  collisionEnabledDuringHarborAssist: true,
});

function characteristics(type) {
  const values = {
    speedboat: { speed: 150, turnRateDeg: 220, collisionRadius: 14 },
    freighter: { speed: 68, turnRateDeg: 95, collisionRadius: 32 },
    tanker: { speed: 78, turnRateDeg: 85, collisionRadius: 30 },
  }[type];
  return Object.freeze({
    type, ...values, unloadStepMs: 900, warningRadius: 76, cargoCapacity: 4,
    pressureWeight: 1, spawnWeight: 1, defaultCargoTypes: Object.freeze(['general']),
  });
}

function dockDefinition() {
  return { id: 'dock', position: { x: 0, y: 0 }, rotationDeg: 0, dockAngle: 0,
    approachRadius: 80, acceptedCargoTypes: ['general'], helperFlag: false, visualVariant: 'test' };
}

function timeToDock(type) {
  const dock = new DockModel(dockDefinition());
  const controller = new DockingController({
    docks: new DockCollection([dock]), dockSystem: new DockSystem(), config: DOCKING_CONFIG,
  });
  const ship = new ShipModel({ id: type, characteristics: characteristics(type),
    position: { x: 80, y: 0 }, rotationDeg: 0, state: ShipState.Navigating, cargo: { general: 1 } });
  controller.step([{ ship, spawnSequence: 1 }], 0);
  let elapsed = 0;
  for (let step = 0; step < 1200; step += 1) {
    const result = controller.step([], 1 / 60);
    elapsed += 1 / 60;
    if (result.completedShipIds.length > 0) return { elapsed, ship, dock };
  }
  throw new Error(`${type} never docked`);
}

test('COR-13 harbor assist uses ship physics instead of a shared 350ms timer', () => {
  const fast = timeToDock('speedboat');
  const slow = timeToDock('freighter');
  assert.ok(fast.elapsed > 0.35, `speedboat still looks like fixed 350ms timer: ${fast.elapsed}`);
  assert.ok(slow.elapsed > fast.elapsed * 1.5, `heavy ship must take materially longer: ${JSON.stringify({fast: fast.elapsed, slow: slow.elapsed})}`);
  assert.deepEqual(fast.ship.position, fast.dock.definition.position);
  assert.deepEqual(slow.ship.position, slow.dock.definition.position);
  assert.equal(fast.ship.state, ShipState.Unloading);
  assert.equal(slow.ship.state, ShipState.Unloading);
});

test('COR-13 departure starts from zero and hands continuous sub-cruise speed to ShipMotor', () => {
  const ship = new ShipModel({ id: 'freighter', characteristics: characteristics('freighter'),
    position: { x: 0, y: 0 }, rotationDeg: 0, state: ShipState.ReadyToLeave, cargo: {} });
  const dock = new DockModel(dockDefinition(), { id: 'dock', reservedBy: null, occupiedBy: ship.id });
  const docking = new DockingController({ docks: new DockCollection([dock]), dockSystem: new DockSystem(), config: DOCKING_CONFIG });
  const routes = new RouteCommitService({ navigation: new NavigationValidator([]), config: { minValidRouteLength: 1, navigationClearanceExtra: 0 } });
  const departure = new DepartureCoordinator({ routes, docking });
  const release = docking.departureRouteStart(ship);
  assert.deepEqual(release, { x: 80, y: 0 });
  const route = new ShipRoute([{ x: 300, y: 0 }], release);
  const result = departure.commit(ship, { route, routeStart: release, progress: 0, kind: 'committed' });
  assert.equal(result.kind, 'committed');
  assert.equal(ship.routeSpeed, 0);
  assert.equal(ship.routeMotionHeld, true);

  let released = false;
  for (let step = 0; step < 1200; step += 1) {
    const dockingResult = docking.step([], 1 / 60);
    if (dockingResult.completedShipIds.includes(ship.id)) { released = true; break; }
  }
  assert.equal(released, true);
  assert.deepEqual(ship.position, release);
  assert.equal(ship.routeMotionHeld, false);
  assert.ok(ship.routeSpeed > 0, 'departure must hand non-zero momentum to route navigation');
  assert.ok(ship.routeSpeed < ship.characteristics.speed, 'departure must not snap directly to cruise speed');

  const handedSpeed = ship.routeSpeed;
  new ShipMotor().stepRoute(ship, 1 / 60);
  assert.ok(ship.x > release.x, 'normal route motion must continue on next fixed step');
  assert.ok(ship.routeSpeed >= handedSpeed, 'normal route motor must continue from handed departure speed');
});

test('COR-13 docking translation follows the lane tangent instead of turning toward the opposite berth heading', () => {
  const ship = new ShipModel({
    id: 'inbound',
    characteristics: characteristics('freighter'),
    position: { x: 0, y: 80 },
    rotationDeg: 270,
    state: ShipState.Docking,
    cargo: { general: 1 },
    routeSpeed: 0,
  });
  const motor = new HarborManeuverMotor();
  const path = Object.freeze({
    start: Object.freeze({ x: 0, y: 80 }),
    points: Object.freeze([
      Object.freeze({ x: 0, y: 44 }),
      Object.freeze({ x: 0, y: 0 }),
    ]),
    finalHeadingDeg: 90,
    phaseProgress: Object.freeze({ approachEnd: 0, alignmentEnd: 36 }),
  });

  const result = motor.step(ship, path, { progress: 0, speed: 0 }, 'docking', 1 / 60);

  assert.equal(result.rotationDeg, 270, 'moving toward berth must keep aiming along the inward lane tangent');
  assert.ok(result.speed > 0, 'a correctly aligned inbound ship must begin creeping instead of pivoting away from berth');
  assert.ok(result.position.y < ship.y, 'inbound harbor assist must advance toward the berth');
});

test('COR-13 final creep is keyed to the authored alignment marker, not a percentage of total capture path', () => {
  const ship = new ShipModel({
    id: 'phase-marker',
    characteristics: characteristics('speedboat'),
    position: { x: 660, y: 0 },
    rotationDeg: 0,
    state: ShipState.Docking,
    cargo: { general: 1 },
    routeSpeed: 0,
  });
  const motor = new HarborManeuverMotor();
  const path = Object.freeze({
    start: Object.freeze({ x: 0, y: 0 }),
    points: Object.freeze([
      Object.freeze({ x: 600, y: 0 }),
      Object.freeze({ x: 650, y: 0 }),
      Object.freeze({ x: 1000, y: 0 }),
    ]),
    finalHeadingDeg: 0,
    phaseProgress: Object.freeze({ approachEnd: 600, alignmentEnd: 650 }),
  });

  const result = motor.step(ship, path, { progress: 660, speed: 0 }, 'docking', 1);

  assert.ok(
    result.speed <= ship.characteristics.speed * 0.15 + 1e-9,
    `speed after alignment marker must be final-creep class, got ${result.speed}`,
  );
});


test('COR-13 harbor capture never translates backward relative to the hull while aligning to the lane', () => {
  const dock = new DockModel(dockDefinition());
  const controller = new DockingController({
    docks: new DockCollection([dock]), dockSystem: new DockSystem(), config: DOCKING_CONFIG,
  });
  const ship = new ShipModel({ id: 'capture-heading', characteristics: characteristics('freighter'),
    position: { x: 80, y: 0 }, rotationDeg: 0, state: ShipState.Navigating, cargo: { general: 1 } });

  controller.step([{ ship, spawnSequence: 1 }], 0);
  let previous = ship.position;
  let sawTranslation = false;
  for (let step = 0; step < 1200 && ship.state !== ShipState.Unloading; step += 1) {
    controller.step([], 1 / 60);
    const current = ship.position;
    const dx = current.x - previous.x;
    const dy = current.y - previous.y;
    const distance = Math.hypot(dx, dy);
    if (distance > 1e-9) {
      sawTranslation = true;
      const radians = ship.rotationDeg * Math.PI / 180;
      const forwardDot = (Math.cos(radians) * dx + Math.sin(radians) * dy) / distance;
      assert.ok(forwardDot >= -1e-9, `harbor assist moved backward relative to hull: ${forwardDot}`);
    }
    previous = current;
  }
  assert.equal(sawTranslation, true);
  assert.equal(ship.state, ShipState.Unloading);
});

test('COR-13 inherited cruise momentum settles to final-creep speed in the last harbor meters', () => {
  const definition = { ...dockDefinition(), approachRadius: 58 };
  const dock = new DockModel(definition);
  const lane = deriveDockLane(definition);
  const controller = new DockingController({
    docks: new DockCollection([dock]), dockSystem: new DockSystem(), config: DOCKING_CONFIG,
  });
  const ship = new ShipModel({ id: 'capture-speed', characteristics: characteristics('speedboat'),
    position: lane.approach, rotationDeg: 180, state: ShipState.Navigating, cargo: { general: 1 } });

  controller.step([{ ship, spawnSequence: 1 }], 0);
  const settledCreepX = lane.alignment.x - definition.approachRadius * 0.12;
  let sawSettledCreep = false;
  for (let step = 0; step < 1200 && ship.state !== ShipState.Unloading; step += 1) {
    controller.step([], 1 / 60);
    if (ship.x <= settledCreepX + 1e-6) {
      sawSettledCreep = true;
      assert.ok(
        ship.routeSpeed <= ship.characteristics.speed * 0.15 + 1e-9,
        `last harbor meters exceeded final-creep speed: ${ship.routeSpeed}`,
      );
    }
  }
  assert.equal(sawSettledCreep, true);
  assert.equal(ship.state, ShipState.Unloading);
});

test('COR-13 berth alignment never applies more than one turn-rate step per fixed tick', () => {
  const ship = new ShipModel({
    id: 'berth-turn-rate',
    characteristics: characteristics('freighter'),
    position: { x: 0, y: 0 },
    rotationDeg: 270,
    state: ShipState.Docking,
    cargo: { general: 1 },
    routeSpeed: 0,
  });
  const motor = new HarborManeuverMotor();
  const path = Object.freeze({
    start: Object.freeze({ x: 0, y: 40 }),
    points: Object.freeze([Object.freeze({ x: 0, y: 0 })]),
    finalHeadingDeg: 90,
    phaseProgress: Object.freeze({ approachEnd: 0, alignmentEnd: 20 }),
  });
  const deltaSeconds = 1 / 60;
  const maximumTurn = ship.characteristics.turnRateDeg * deltaSeconds;

  const result = motor.step(
    ship,
    path,
    { progress: 40, speed: 0 },
    'docking',
    deltaSeconds,
  );
  const actualTurn = Math.abs(((result.rotationDeg - ship.rotationDeg + 540) % 360) - 180);

  assert.ok(
    actualTurn <= maximumTurn + 1e-9,
    `berth alignment exceeded turn-rate authority: ${actualTurn} > ${maximumTurn}`,
  );
});
