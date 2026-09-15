import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LandRecoveryMotion,
  ShipModel,
} from '../src/ships/ShipModel.ts';
import { ShipCharacteristicsRegistry } from '../src/ships/ShipCharacteristics.ts';
import { ShipRoute } from '../src/ships/ShipRoute.ts';
import { ShipState } from '../src/ships/ShipState.ts';

const characteristics = Object.freeze({
  type: 'freighter',
  speed: 68,
  turnRateDeg: 95,
  collisionRadius: 32,
  unloadStepMs: 900,
  warningRadius: 76,
  cargoCapacity: 4,
  pressureWeight: 2.8,
  spawnWeight: 10,
  defaultCargoTypes: Object.freeze(['general']),
});

function makeShip(overrides = {}) {
  return new ShipModel({
    id: overrides.id ?? 'land-recovery-ship',
    characteristics: overrides.characteristics ?? characteristics,
    position: overrides.position ?? { x: 0, y: 0 },
    rotationDeg: overrides.rotationDeg ?? 0,
    state: overrides.state ?? ShipState.Navigating,
    cargo: overrides.cargo ?? { general: 1 },
    route: overrides.route,
    routeProgress: overrides.routeProgress,
    routeSpeed: overrides.routeSpeed,
    landRecoveryHeadingDeg: overrides.landRecoveryHeadingDeg,
    landRecoveryTurnSign: overrides.landRecoveryTurnSign,
    landRecoveryMotion: overrides.landRecoveryMotion,
  });
}

function registryFor(ship) {
  return new ShipCharacteristicsRegistry(new Map([
    [ship.characteristics.type, ship.characteristics],
  ]));
}

test('LAND RECOVERY model state is atomic, snapshot-backed, and preserves physical speed', () => {
  assert.equal(LandRecoveryMotion.Arc, 'arc');
  assert.equal(LandRecoveryMotion.Pivot, 'pivot');

  const ship = makeShip({ routeSpeed: 31 });
  const route = new ShipRoute([{ x: 20, y: 0 }], ship.position);
  ship.replaceRoute(route, ship.position, route.totalLength);
  ship.setPosition(route.pointAtDistance(route.totalLength));
  ship.setRouteSpeed(31);
  const revisionBefore = ship.routeRevision;

  ship.beginLandRecovery(540, 1, LandRecoveryMotion.Arc);

  assert.equal(ship.route, null, 'consumed route is removed when recovery takes authority');
  assert.equal(ship.routeSpeed, 31, 'starting recovery preserves current physical speed');
  assert.equal(ship.landRecoveryHeadingDeg, 180);
  assert.equal(ship.landRecoveryTurnSign, 1);
  assert.equal(ship.landRecoveryMotion, LandRecoveryMotion.Arc);
  assert.equal(ship.routeRevision, revisionBefore + 1);

  const snapshot = ship.toSnapshot();
  assert.equal(snapshot.landRecoveryHeadingDeg, 180);
  assert.equal(snapshot.landRecoveryTurnSign, 1);
  assert.equal(snapshot.landRecoveryMotion, LandRecoveryMotion.Arc);

  const restored = ShipModel.restore(snapshot, registryFor(ship));
  assert.equal(restored.landRecoveryHeadingDeg, 180);
  assert.equal(restored.landRecoveryTurnSign, 1);
  assert.equal(restored.landRecoveryMotion, LandRecoveryMotion.Arc);
  assert.equal(restored.routeSpeed, 31);

  restored.finishLandRecovery();
  assert.equal(restored.landRecoveryHeadingDeg, null);
  assert.equal(restored.landRecoveryTurnSign, null);
  assert.equal(restored.landRecoveryMotion, null);
});

test('LAND RECOVERY rejects partial state and unfinished authored route, and replaceRoute cancels recovery', () => {
  const registry = registryFor(makeShip());
  assert.throws(
    () => ShipModel.restore({
      ...makeShip().toSnapshot(),
      landRecoveryHeadingDeg: 180,
    }, registry),
    /land recovery/i,
  );

  const routedSnapshotShip = makeShip();
  const routedSnapshotRoute = new ShipRoute([{ x: 100, y: 0 }], routedSnapshotShip.position);
  routedSnapshotShip.replaceRoute(routedSnapshotRoute, routedSnapshotShip.position, routedSnapshotRoute.totalLength);
  assert.throws(
    () => ShipModel.restore({
      ...routedSnapshotShip.toSnapshot(),
      landRecoveryHeadingDeg: 180,
      landRecoveryTurnSign: -1,
      landRecoveryMotion: LandRecoveryMotion.Arc,
    }, registry),
    /land recovery.*route|route.*land recovery/i,
    'active land recovery snapshot must not also carry an authored route',
  );

  const ship = makeShip({ routeSpeed: 40 });
  const unfinished = new ShipRoute([{ x: 100, y: 0 }], ship.position);
  ship.replaceRoute(unfinished, ship.position, 20);
  assert.throws(
    () => ship.beginLandRecovery(180, -1, LandRecoveryMotion.Arc),
    /unfinished|consumed/i,
  );

  ship.advanceRouteProgress(unfinished.totalLength);
  ship.setPosition(unfinished.pointAtDistance(unfinished.totalLength));
  ship.beginLandRecovery(180, -1, LandRecoveryMotion.Pivot);
  assert.equal(ship.landRecoveryMotion, LandRecoveryMotion.Pivot);

  ship.replaceRoute(new ShipRoute([{ x: 160, y: 0 }], ship.position), ship.position);
  assert.equal(ship.landRecoveryHeadingDeg, null);
  assert.equal(ship.landRecoveryTurnSign, null);
  assert.equal(ship.landRecoveryMotion, null);
});

import { ShipMotor } from '../src/ships/ShipMotor.ts';
import { LandClearanceGeometry } from '../src/geometry/LandClearanceGeometry.ts';
import { LandRecoverySystem } from '../src/grounding/LandRecoverySystem.ts';
import { GroundingSystem } from '../src/grounding/GroundingSystem.ts';

const DT = 1 / 60;

test('LAND RECOVERY arc motor turns in stored direction at physical turn rate and preserves speed', () => {
  const ship = makeShip({ position: { x: 100, y: 100 }, rotationDeg: 0, routeSpeed: 34 });
  ship.setRouteSpeed(34);
  ship.beginLandRecovery(180, 1, LandRecoveryMotion.Arc);
  const motor = new ShipMotor();
  const before = ship.position;

  motor.stepRoute(ship, DT);

  const maxTurn = ship.characteristics.turnRateDeg * DT;
  assert.ok(Math.abs(ship.rotationDeg - maxTurn) < 1e-9, `expected +${maxTurn} deg, got ${ship.rotationDeg}`);
  assert.equal(ship.routeSpeed, 34);
  assert.ok(Math.hypot(ship.x - before.x, ship.y - before.y) > 0, 'arc recovery must translate');
  assert.ok(Math.hypot(ship.x - before.x, ship.y - before.y) <= 34 * DT + 1e-9);

  const leftShip = makeShip({ position: { x: 100, y: 100 }, rotationDeg: 0, routeSpeed: 34 });
  leftShip.setRouteSpeed(34);
  leftShip.beginLandRecovery(180, -1, LandRecoveryMotion.Arc);
  motor.stepRoute(leftShip, DT);
  assert.ok(Math.abs(leftShip.rotationDeg - (360 - maxTurn)) < 1e-9, `expected -${maxTurn} deg, got ${leftShip.rotationDeg}`);
});

test('LAND RECOVERY pivot motor turns physically without translation and holds speed zero', () => {
  const ship = makeShip({ position: { x: 100, y: 100 }, rotationDeg: 0, routeSpeed: 20 });
  ship.setRouteSpeed(20);
  ship.beginLandRecovery(180, 1, LandRecoveryMotion.Pivot);
  const motor = new ShipMotor();
  const before = ship.position;

  motor.stepRoute(ship, DT);

  assert.deepEqual(ship.position, before);
  assert.equal(ship.routeSpeed, 0);
  assert.ok(ship.rotationDeg > 0 && ship.rotationDeg <= ship.characteristics.turnRateDeg * DT + 1e-9);
  assert.equal(ship.landRecoveryHeadingDeg, 180, 'motor must not finish recovery; hazards owns completion');
});


function verticalShore(x = 300) {
  return new LandClearanceGeometry([{
    points: Object.freeze([
      Object.freeze({ x, y: -1000 }),
      Object.freeze({ x: 1000, y: -1000 }),
      Object.freeze({ x: 1000, y: 1000 }),
      Object.freeze({ x, y: 1000 }),
    ]),
  }]);
}

function recoveryStats(type, speed, turnRateDeg, collisionRadius) {
  return Object.freeze({
    ...characteristics,
    type,
    speed,
    turnRateDeg,
    collisionRadius,
  });
}

function recoveryStartX(stats, shoreX = 300, extra = 0) {
  const radius = stats.speed / (stats.turnRateDeg * Math.PI / 180);
  return shoreX - (stats.collisionRadius + extra) - radius - 2;
}

test('LAND RECOVERY system starts before flat-shore contact and leaves an unfinished route whose continuation is clear untouched', () => {
  const geometry = verticalShore();
  const system = new LandRecoverySystem({ geometry, navigationClearanceExtra: 0 });
  const stats = recoveryStats('freighter', 68, 95, 32);
  const ship = makeShip({ characteristics: stats, position: { x: recoveryStartX(stats), y: 0 }, rotationDeg: 0, routeSpeed: stats.speed });
  ship.setRouteSpeed(stats.speed);

  const result = system.step([ship], DT);
  assert.deepEqual(result.startedShipIds, [ship.id]);
  assert.notEqual(ship.landRecoveryHeadingDeg, null);
  assert.equal(ship.landRecoveryMotion, LandRecoveryMotion.Arc);
  assert.equal(ship.landRecoveryTurnSign, -1, 'symmetric candidates must prefer left before right');

  const routed = makeShip({ id: 'unfinished', characteristics: stats, position: { x: 220, y: 100 }, rotationDeg: 90, routeSpeed: stats.speed });
  const route = new ShipRoute([{ x: 220, y: 200 }], routed.position);
  routed.replaceRoute(route, routed.position, 10);
  const before = routed.toSnapshot();
  const routedResult = system.step([routed], DT);
  assert.deepEqual(routedResult.startedShipIds, []);
  assert.equal(routed.landRecoveryHeadingDeg, null);
  assert.equal(routed.routeProgress, before.routeProgress);
  assert.notEqual(routed.route, null);
});

test('LAND RECOVERY heavy ship predicts land farther away and physically takes longer to reverse', () => {
  const geometry = verticalShore();
  const system = new LandRecoverySystem({ geometry, navigationClearanceExtra: 0 });
  const speedboatStats = recoveryStats('speedboat', 150, 220, 18);
  const tankerStats = recoveryStats('tanker', 78, 85, 40);
  const speedboatStart = recoveryStartX(speedboatStats);
  const tankerStart = recoveryStartX(tankerStats);
  assert.ok(tankerStart < speedboatStart, `tanker should start farther away: tanker=${tankerStart}, speedboat=${speedboatStart}`);

  const speedboat = makeShip({ id: 'speedboat', characteristics: speedboatStats, position: { x: speedboatStart, y: -120 }, rotationDeg: 0, routeSpeed: speedboatStats.speed });
  const tanker = makeShip({ id: 'tanker', characteristics: tankerStats, position: { x: tankerStart, y: 120 }, rotationDeg: 0, routeSpeed: tankerStats.speed });
  speedboat.setRouteSpeed(speedboatStats.speed);
  tanker.setRouteSpeed(tankerStats.speed);
  system.step([speedboat, tanker], DT);

  const motor = new ShipMotor();
  let speedboatTicks = 0;
  let tankerTicks = 0;
  while (speedboat.landRecoveryHeadingDeg !== null && speedboatTicks < 500) {
    system.step([speedboat], DT);
    motor.stepRoute(speedboat, DT);
    speedboatTicks += 1;
  }
  while (tanker.landRecoveryHeadingDeg !== null && tankerTicks < 500) {
    system.step([tanker], DT);
    motor.stepRoute(tanker, DT);
    tankerTicks += 1;
  }
  assert.ok(speedboatTicks > 0 && speedboatTicks < 500);
  assert.ok(tankerTicks > speedboatTicks, `tanker=${tankerTicks}, speedboat=${speedboatTicks}`);
});

test('LAND RECOVERY arc stays outside clearance for all four ship types', () => {
  const geometry = verticalShore();
  const variants = [
    recoveryStats('speedboat', 150, 220, 18),
    recoveryStats('cargo_boat', 105, 155, 24),
    recoveryStats('freighter', 68, 95, 32),
    recoveryStats('tanker', 78, 85, 40),
  ];
  for (let index = 0; index < variants.length; index += 1) {
    const stats = variants[index];
    const system = new LandRecoverySystem({ geometry, navigationClearanceExtra: 0 });
    const ship = makeShip({ id: `arc-${stats.type}`, characteristics: stats, position: { x: recoveryStartX(stats), y: index * 140 - 210 }, rotationDeg: 0, routeSpeed: stats.speed });
    ship.setRouteSpeed(stats.speed);
    const started = system.step([ship], DT);
    assert.deepEqual(started.startedShipIds, [ship.id], `${stats.type}: recovery did not start`);
    assert.equal(ship.landRecoveryMotion, LandRecoveryMotion.Arc, `${stats.type}: expected normal arc recovery`);
    const motor = new ShipMotor();
    for (let frame = 0; frame < 500 && ship.landRecoveryHeadingDeg !== null; frame += 1) {
      const before = ship.position;
      system.step([ship], DT);
      motor.stepRoute(ship, DT);
      assert.equal(
        geometry.blocksSegment(before, ship.position, stats.collisionRadius),
        false,
        `${stats.type}: recovery arc entered land clearance`,
      );
    }
    assert.equal(ship.landRecoveryHeadingDeg, null, `${stats.type}: recovery did not finish`);
  }
});

test('LAND RECOVERY ignores boundary recovery and non-free-water lifecycle states', () => {
  const geometry = verticalShore();
  const system = new LandRecoverySystem({ geometry, navigationClearanceExtra: 0 });
  const stats = recoveryStats('freighter', 68, 95, 32);
  const boundary = makeShip({ id: 'boundary', characteristics: stats, position: { x: 240, y: 0 }, rotationDeg: 0, routeSpeed: stats.speed });
  boundary.beginRouteRecovery(180);
  system.step([boundary], DT);
  assert.equal(boundary.landRecoveryHeadingDeg, null);
  assert.equal(boundary.routeRecoveryHeadingDeg, 180);

  for (const state of [ShipState.Docking, ShipState.Unloading, ShipState.ReadyToLeave]) {
    const ship = makeShip({ id: `state-${state}`, characteristics: stats, position: { x: 240, y: 0 }, rotationDeg: 0, routeSpeed: stats.speed, state });
    system.step([ship], DT);
    assert.equal(ship.landRecoveryHeadingDeg, null, `${state} must not enter land recovery`);
  }
});


test('LAND RECOVERY uses emergency pivot when no moving arc can clear the shore', () => {
  const geometry = verticalShore();
  const system = new LandRecoverySystem({ geometry, navigationClearanceExtra: 0 });
  const stats = recoveryStats('freighter', 68, 95, 32);
  const ship = makeShip({ characteristics: stats, position: { x: 250, y: 0 }, rotationDeg: 0, routeSpeed: stats.speed });
  ship.setRouteSpeed(stats.speed);

  const result = system.step([ship], DT);

  assert.deepEqual(result.startedShipIds, [ship.id]);
  assert.equal(ship.landRecoveryMotion, LandRecoveryMotion.Pivot);
  assert.equal(ship.landRecoveryTurnSign, -1);
  const before = ship.position;
  new ShipMotor().stepRoute(ship, DT);
  assert.deepEqual(ship.position, before, 'emergency pivot must not translate toward land');
  assert.equal(ship.routeSpeed, 0);
});

test('LAND RECOVERY snapshot restore halfway through recovery reproduces the same next fixed-step pose', () => {
  const geometry = verticalShore();
  const system = new LandRecoverySystem({ geometry, navigationClearanceExtra: 0 });
  const stats = recoveryStats('freighter', 68, 95, 32);
  const original = makeShip({ characteristics: stats, position: { x: recoveryStartX(stats), y: 0 }, rotationDeg: 0, routeSpeed: 41 });
  original.setRouteSpeed(41);
  system.step([original], DT);
  const motor = new ShipMotor();
  for (let frame = 0; frame < 20; frame += 1) {
    system.step([original], DT);
    motor.stepRoute(original, DT);
  }
  const restored = ShipModel.restore(original.toSnapshot(), registryFor(original));

  system.step([original], DT);
  motor.stepRoute(original, DT);
  system.step([restored], DT);
  motor.stepRoute(restored, DT);

  assert.deepEqual(restored.toSnapshot(), original.toSnapshot());
});

test('LAND RECOVERY keeps GroundingSystem terminal for an actual forbidden moved segment', () => {
  const geometry = verticalShore();
  const grounding = new GroundingSystem({ geometry, navigationClearanceExtra: 0 });
  const stats = recoveryStats('freighter', 68, 95, 32);
  const ship = makeShip({ characteristics: stats, position: { x: 290, y: 0 }, rotationDeg: 0, routeSpeed: stats.speed });
  const result = grounding.resolve([{
    ship,
    spawnSequence: 0,
    previousPosition: { x: 250, y: 0 },
  }]);
  assert.deepEqual(result.terminalGrounding, { shipId: ship.id, failReason: 'grounding' });
});

test('LAND RECOVERY finish preserves sub-cruise momentum without snapping to full speed', () => {
  const geometry = verticalShore();
  const system = new LandRecoverySystem({ geometry, navigationClearanceExtra: 0 });
  const stats = recoveryStats('freighter', 68, 95, 32);
  const ship = makeShip({
    characteristics: stats,
    position: { x: 100, y: 0 },
    rotationDeg: 180,
    routeSpeed: 30,
    landRecoveryHeadingDeg: 180,
    landRecoveryTurnSign: -1,
    landRecoveryMotion: LandRecoveryMotion.Arc,
  });
  const motor = new ShipMotor();
  const before = ship.position;

  const result = system.step([ship], DT);
  assert.deepEqual(result.finishedShipIds, [ship.id]);
  assert.equal(ship.landRecoveryHeadingDeg, null);

  motor.stepRoute(ship, DT);

  const travelled = Math.hypot(ship.x - before.x, ship.y - before.y);
  assert.ok(ship.routeSpeed > 30, `expected smooth acceleration from 30, got ${ship.routeSpeed}`);
  assert.ok(ship.routeSpeed < stats.speed, `must not snap to full cruise ${stats.speed}`);
  assert.ok(travelled <= ship.routeSpeed * DT + 1e-9);
  assert.ok(travelled < stats.speed * DT - 1e-6, 'first post-recovery tick must remain sub-cruise');
});

test('LAND RECOVERY takes over a straight authored route early enough for a moving arc when its post-route continuation would hit land', () => {
  const geometry = verticalShore(430);
  const system = new LandRecoverySystem({ geometry, navigationClearanceExtra: 4 });
  const stats = recoveryStats('freighter', 68, 95, 32);
  const ship = makeShip({
    characteristics: stats,
    position: { x: 314, y: 0 },
    rotationDeg: 0,
    routeSpeed: stats.speed,
  });
  const route = new ShipRoute([{ x: 370, y: 0 }], ship.position);
  ship.replaceRoute(route, ship.position, 0);
  ship.setRouteSpeed(stats.speed);

  const result = system.step([ship], DT);

  assert.deepEqual(result.startedShipIds, [ship.id]);
  assert.equal(ship.landRecoveryMotion, LandRecoveryMotion.Arc, 'normal draw-to-land case should remain a moving turn, not emergency pivot');
  assert.equal(ship.route, null, 'safety recovery takes authority instead of reaching the too-close route endpoint');
  assert.equal(ship.routeSpeed, stats.speed, 'route safety takeover preserves physical speed');
});

test('LAND RECOVERY zero-speed hazard uses pivot instead of reporting a non-moving arc', () => {
  const geometry = verticalShore();
  const system = new LandRecoverySystem({ geometry, navigationClearanceExtra: 0 });
  const stats = recoveryStats('freighter', 68, 95, 32);
  const ship = makeShip({
    characteristics: stats,
    position: { x: recoveryStartX(stats), y: 0 },
    rotationDeg: 0,
    routeSpeed: 0,
  });
  ship.setRouteSpeed(0);

  const result = system.step([ship], DT);

  assert.deepEqual(result.startedShipIds, [ship.id]);
  assert.equal(
    ship.landRecoveryMotion,
    LandRecoveryMotion.Pivot,
    'zero physical speed cannot truthfully execute a moving recovery arc',
  );
  const before = ship.position;
  const motor = new ShipMotor();
  motor.stepRoute(ship, DT);
  assert.deepEqual(ship.position, before, 'pivot must rotate before accelerating away from land');
  assert.equal(ship.routeSpeed, 0);

  for (let frame = 0; frame < 240 && ship.landRecoveryHeadingDeg !== null; frame += 1) {
    system.step([ship], DT);
    motor.stepRoute(ship, DT);
  }
  assert.equal(ship.landRecoveryHeadingDeg, null, 'pivot recovery must eventually release authority');
  const releasePosition = ship.position;
  motor.stepRoute(ship, DT);
  assert.ok(ship.routeSpeed > 0 && ship.routeSpeed < stats.speed, 'post-pivot autonomous motion must accelerate smoothly from zero');
  assert.ok(Math.hypot(ship.x - releasePosition.x, ship.y - releasePosition.y) > 0, 'ship must move away after the recovery pivot completes');
});
