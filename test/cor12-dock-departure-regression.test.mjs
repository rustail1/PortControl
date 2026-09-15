import assert from 'node:assert/strict';
import test from 'node:test';

import { SquareWorldViewport } from '../src/camera/SquareWorldViewport.ts';
import { DockModel, DockCollection } from '../src/docks/DockModel.ts';
import { DockSystem } from '../src/docks/DockSystem.ts';
import { DockingController } from '../src/docks/DockingController.ts';
import { DepartureCoordinator } from '../src/docks/DepartureCoordinator.ts';
import { LandClearanceGeometry } from '../src/geometry/LandClearanceGeometry.ts';
import { NavigationValidator } from '../src/routes/NavigationValidator.ts';
import { RouteCommitService } from '../src/routes/RouteCommitService.ts';
import { RouteInputController } from '../src/routes/RouteInputController.ts';
import { ShipModel } from '../src/ships/ShipModel.ts';
import { ShipMotor } from '../src/ships/ShipMotor.ts';
import { ShipState } from '../src/ships/ShipState.ts';

const DOCKING_CONFIG = Object.freeze({
    reservationTieBreak: 'distance_then_spawn_sequence',
  collisionEnabledDuringHarborAssist: true,
});

const ROUTE_CONFIG = Object.freeze({
  simplifyEpsilon: 3.5,
  minValidRouteLength: 12,
  maxSimplifiedPoints: 96,
  navigationClearanceExtra: 4,
});

function characteristics(type = 'speedboat') {
  const values = {
    speedboat: { speed: 150, turnRateDeg: 220, collisionRadius: 14 },
    freighter: { speed: 68, turnRateDeg: 95, collisionRadius: 32 },
    tanker: { speed: 78, turnRateDeg: 85, collisionRadius: 30 },
  }[type];
  if (!values) throw new Error(`unknown test ship ${type}`);
  return Object.freeze({
    type,
    ...values,
    unloadStepMs: 900,
    warningRadius: 76,
    cargoCapacity: 4,
    pressureWeight: 1,
    spawnWeight: 1,
    defaultCargoTypes: Object.freeze(['general']),
  });
}

function dockDefinition(overrides = {}) {
  return {
    id: 'dock',
    position: { x: 500, y: 500 },
    rotationDeg: 0,
    dockAngle: 0,
    approachRadius: 80,
    acceptedCargoTypes: ['general'],
    helperFlag: false,
    visualVariant: 'dock_general',
    ...overrides,
  };
}

function shipAt(position, options = {}) {
  return new ShipModel({
    id: options.id ?? 'ship',
    characteristics: characteristics(options.type ?? 'speedboat'),
    position,
    rotationDeg: options.rotationDeg ?? 0,
    state: options.state ?? ShipState.Navigating,
    cargo: options.cargo ?? { general: 1 },
  });
}

function createDocking(definition, options = {}) {
  const dock = new DockModel(definition);
  const dockSystem = new DockSystem();
  const controller = new DockingController({
    docks: new DockCollection([dock]),
    dockSystem,
    config: DOCKING_CONFIG,
    ...options,
  });
  return { dock, dockSystem, controller };
}

function pointer(x, y, pointerId = 1) {
  return {
    source: 'mouse',
    pointerId,
    screenPosition: { x, y },
    cssPosition: { x, y },
    internalViewport: { width: 1000, height: 1000 },
    worldToCssPixelScale: 1,
  };
}

test('dock capture radius is centered on approachPoint, not berth', () => {
  const definition = dockDefinition();

  {
    const { dock, controller } = createDocking(definition);
    const ship = shipAt({ x: 650, y: 500 }); // 70 from approach=(580,500), 150 from berth.
    const result = controller.step([{ ship, spawnSequence: 0 }], 0);
    assert.deepEqual(result.reservedShipIds, [ship.id]);
    assert.equal(ship.state, ShipState.ApproachingDock);
    assert.equal(dock.reservedBy, ship.id);
  }

  {
    const { dock, controller } = createDocking(definition);
    const ship = shipAt({ x: 500, y: 560 }); // 60 from berth, 100 from approach.
    const result = controller.step([{ ship, spawnSequence: 0 }], 0);
    assert.deepEqual(result.reservedShipIds, []);
    assert.equal(ship.state, ShipState.Navigating);
    assert.equal(dock.reservedBy, null);
  }
});

test('inbound harbor assist is ship-specific and no longer completes on a shared 350ms timer', () => {
  const elapsedByType = new Map();
  for (const type of ['speedboat', 'freighter', 'tanker']) {
    const { dock, controller } = createDocking(dockDefinition());
    const ship = shipAt({ x: 580, y: 500 }, { type, id: type, rotationDeg: 0 });
    controller.step([{ ship, spawnSequence: 0 }], 0);
    let elapsed = 0;
    for (let step = 0; step < 1200; step += 1) {
      const result = controller.step([], 1 / 60);
      elapsed += 1 / 60;
      if (result.completedShipIds.includes(ship.id)) break;
    }
    elapsedByType.set(type, elapsed);
    assert.ok(elapsed > 0.35, `${type} must use physical harbor assist instead of the 350ms timer`);
    assert.equal(ship.state, ShipState.Unloading, type);
    assert.deepEqual(ship.position, dock.definition.position, type);
    assert.equal(ship.rotationDeg, dock.definition.dockAngle, type);
    assert.equal(dock.occupiedBy, ship.id, type);
  }
  assert.ok(elapsedByType.get('freighter') > elapsedByType.get('speedboat'));
});

test('ReadyToLeave drawing keeps release as route origin while authored points stay pointer-WYSIWYG', () => {
  const ship = shipAt(
    { x: 500, y: 500 },
    { state: ShipState.ReadyToLeave, cargo: {}, id: 'out' },
  );
  const release = { x: 500, y: 600 };
  const controller = new RouteInputController({
    viewport: new SquareWorldViewport({ width: 1000, height: 1000 }),
    sampling: { sampleDistance: 8, maxRawPoints: 256 },
    hitTest: () => ship,
    routeStartForShip: () => release,
  });

  controller.pointerDown(pointer(500, 500));
  controller.pointerMove(pointer(650, 500));
  const draft = controller.activeDraftSnapshot;

  assert.ok(draft);
  assert.deepEqual(draft.start, release);
  assert.deepEqual(draft.points, [{ x: 650, y: 500 }]);
});

test('freighter outbound gesture stays pointer-WYSIWYG, clears quay, departs, and resumes movement', () => {
  const definition = dockDefinition({ dockAngle: 90, approachRadius: 100 });
  const land = new LandClearanceGeometry([{
    points: [
      { x: 0, y: 0 }, { x: 1000, y: 0 },
      { x: 1000, y: 550 }, { x: 0, y: 550 },
    ],
  }]);
  const { dock, dockSystem, controller: docking } = createDocking(definition, {
    landGeometry: land,
    navigationClearanceExtra: 4,
  });
  const ship = shipAt(definition.position, {
    type: 'freighter',
    id: 'freighter-out',
    state: ShipState.ReadyToLeave,
    cargo: {},
    rotationDeg: definition.dockAngle,
  });
  assert.equal(dockSystem.reserve(dock, { id: ship.id, cargo: { general: 1 } }).status, 'eligible');
  assert.equal(dockSystem.occupyReserved(dock, ship.id), true);
  const release = docking.departureRouteStart(ship);
  assert.deepEqual(release, { x: 500, y: 600 });

  const input = new RouteInputController({
    viewport: new SquareWorldViewport({ width: 1000, height: 1000 }),
    sampling: { sampleDistance: 8, maxRawPoints: 256 },
    hitTest: () => ship,
    routeStartForShip: () => release,
  });
  input.pointerDown(pointer(500, 500));
  input.pointerMove(pointer(700, 600));
  const outcome = input.pointerUp(pointer(760, 600));
  assert.equal(outcome.kind, 'finished');
  assert.deepEqual(outcome.draft.start, release);
  assert.deepEqual(outcome.draft.points, [{ x: 700, y: 600 }, { x: 760, y: 600 }]);

  const commit = new RouteCommitService({
    navigation: new NavigationValidator(land.polygons),
    config: ROUTE_CONFIG,
  });
  const prepared = commit.prepare({ ship, draft: outcome.draft, routeStart: release });
  assert.ok('route' in prepared);
  const departure = new DepartureCoordinator({ routes: commit, docking });
  const committed = departure.commit(ship, prepared);
  assert.equal(committed.kind, 'committed');
  assert.equal(ship.state, ShipState.Leaving);
  assert.equal(ship.routeMotionHeld, true);

  for (let step = 0; step < 1200 && docking.isShipInManeuver(ship.id); step += 1) {
    docking.step([], 1 / 60);
  }
  assert.deepEqual(ship.position, release);
  assert.equal(ship.routeMotionHeld, false);
  assert.equal(dock.occupiedBy, null);
  assert.ok(ship.routeSpeed > 0 && ship.routeSpeed < ship.characteristics.speed);

  const before = ship.position;
  new ShipMotor().stepRoute(ship, 1 / 60);
  assert.ok(ship.x > before.x, 'ship must advance along outbound route after guided departure');
  assert.equal(ship.y, before.y);
});

test('minimum outbound route length is measured from authoritative release origin', () => {
  const ship = shipAt(
    { x: 500, y: 500 },
    { state: ShipState.ReadyToLeave, cargo: {}, id: 'short-out' },
  );
  const commit = new RouteCommitService({
    navigation: new NavigationValidator([]),
    config: ROUTE_CONFIG,
  });
  const release = { x: 580, y: 500 };
  const result = commit.prepare({
    ship,
    routeStart: release,
    draft: {
      shipId: ship.id,
      start: release,
      points: [{ x: 582, y: 500 }],
    },
  });
  assert.equal(result.kind, 'rejected_too_short');
  assert.equal(ship.state, ShipState.ReadyToLeave);
});
