import assert from 'node:assert/strict';
import test from 'node:test';

import { SelectionPulsePresentation } from '../src/presentation/SelectionPulsePresentation.ts';
import * as PulseModule from '../src/presentation/SelectionPulsePresentation.ts';
import { ShipState } from '../src/ships/ShipState.ts';
function sample(pulse, shipId = 'ship-a') {
  return pulse.sampleFor(shipId);
}

test('selection pulse eases in, expands, contracts, fades, then disappears', () => {
  const pulse = new SelectionPulsePresentation();
  assert.equal(sample(pulse), null);

  pulse.begin('ship-a');
  const start = sample(pulse);
  assert.notEqual(start, null);
  assert.equal(start.radiusCssPx, 22);
  assert.equal(start.alpha, 0);

  pulse.advance(80);
  const appearing = sample(pulse);
  assert.notEqual(appearing, null);
  assert.ok(appearing.radiusCssPx > start.radiusCssPx);
  assert.ok(appearing.alpha > 0 && appearing.alpha < 1);

  pulse.advance(120);
  const peak = sample(pulse);
  assert.notEqual(peak, null);
  assert.ok(Math.abs(peak.radiusCssPx - 39) < 0.001);
  assert.ok(Math.abs(peak.alpha - 1) < 0.001);

  pulse.advance(125);
  const settling = sample(pulse);
  assert.notEqual(settling, null);
  assert.ok(settling.radiusCssPx < peak.radiusCssPx);
  assert.ok(settling.radiusCssPx > 30);
  assert.ok(settling.alpha < 1 && settling.alpha > 0);

  pulse.advance(125);
  assert.equal(sample(pulse), null);
  assert.equal(pulse.activeShipId, null);
});

test('re-clicking the active ship restarts smoothly from the current visual state', () => {
  const pulse = new SelectionPulsePresentation();
  pulse.begin('ship-a');
  pulse.advance(110);
  const beforeRestart = sample(pulse);
  assert.notEqual(beforeRestart, null);

  pulse.begin('ship-a');
  const afterRestart = sample(pulse);
  assert.notEqual(afterRestart, null);
  assert.ok(Math.abs(afterRestart.radiusCssPx - beforeRestart.radiusCssPx) < 1e-9);
  assert.ok(Math.abs(afterRestart.alpha - beforeRestart.alpha) < 1e-9);

  pulse.advance(50);
  const resumed = sample(pulse);
  assert.notEqual(resumed, null);
  assert.ok(resumed.radiusCssPx >= afterRestart.radiusCssPx);
  assert.ok(resumed.alpha >= afterRestart.alpha);
});

test('clicking the same ship after the pulse disappeared starts a fresh pulse', () => {
  const pulse = new SelectionPulsePresentation();
  pulse.begin('ship-a');
  pulse.advance(450);
  assert.equal(sample(pulse), null);

  pulse.begin('ship-a');
  const fresh = sample(pulse);
  assert.notEqual(fresh, null);
  assert.equal(fresh.radiusCssPx, 22);
  assert.equal(fresh.alpha, 0);
});

test('pulse is visible only for the ship that was clicked', () => {
  const pulse = new SelectionPulsePresentation();
  pulse.begin('ship-a');
  pulse.advance(60);
  assert.equal(sample(pulse, 'ship-b'), null);
  assert.notEqual(sample(pulse, 'ship-a'), null);
});

import { readFileSync } from 'node:fs';

test('HarborScene renders the pulse using both eased radius and eased alpha', () => {
  const source = readFileSync(new URL('../src/scenes/HarborScene.ts', import.meta.url), 'utf8');
  assert.match(source, /#selectionPulse\.sampleFor\(selected\.ship\.id\)/);
  assert.match(source, /lineStyle\([\s\S]{0,160}pulseSample\.alpha/);
});

test('ready-to-leave transition emits exactly two one-shot pulses and then stops', () => {
  const ReadyPulse = PulseModule.ReadyToLeavePulsePresentation;
  assert.equal(typeof ReadyPulse, 'function');
  const pulse = new ReadyPulse();

  pulse.observe([{ id: 'ship-ready', state: ShipState.Unloading }]);
  assert.equal(pulse.sampleFor('ship-ready'), null);

  pulse.observe([{ id: 'ship-ready', state: ShipState.ReadyToLeave }]);
  const firstStart = pulse.sampleFor('ship-ready');
  assert.notEqual(firstStart, null);
  assert.equal(firstStart.radiusCssPx, 22);
  assert.equal(firstStart.alpha, 0);

  pulse.advance(200);
  const firstPeak = pulse.sampleFor('ship-ready');
  assert.notEqual(firstPeak, null);
  assert.ok(Math.abs(firstPeak.radiusCssPx - 39) < 0.001);
  assert.ok(Math.abs(firstPeak.alpha - 1) < 0.001);

  pulse.advance(250);
  assert.equal(pulse.sampleFor('ship-ready'), null);

  pulse.advance(100);
  const secondStart = pulse.sampleFor('ship-ready');
  assert.notEqual(secondStart, null);
  assert.equal(secondStart.radiusCssPx, 22);
  assert.equal(secondStart.alpha, 0);

  pulse.advance(450);
  assert.equal(pulse.sampleFor('ship-ready'), null);

  pulse.advance(1000);
  assert.equal(pulse.sampleFor('ship-ready'), null);
});

test('ready-to-leave pulse triggers once per Unloading to ReadyToLeave transition', () => {
  const ReadyPulse = PulseModule.ReadyToLeavePulsePresentation;
  assert.equal(typeof ReadyPulse, 'function');
  const pulse = new ReadyPulse();

  pulse.observe([{ id: 'ship-ready', state: ShipState.Unloading }]);
  pulse.observe([{ id: 'ship-ready', state: ShipState.ReadyToLeave }]);
  pulse.advance(1100);
  assert.equal(pulse.sampleFor('ship-ready'), null);

  pulse.observe([{ id: 'ship-ready', state: ShipState.ReadyToLeave }]);
  assert.equal(pulse.sampleFor('ship-ready'), null);

  pulse.observe([{ id: 'ship-ready', state: ShipState.Leaving }]);
  pulse.observe([{ id: 'ship-ready', state: ShipState.Unloading }]);
  pulse.observe([{ id: 'ship-ready', state: ShipState.ReadyToLeave }]);
  assert.notEqual(pulse.sampleFor('ship-ready'), null);
});

test('HarborScene observes ReadyToLeave transitions and renders the automatic double pulse', () => {
  const source = readFileSync(new URL('../src/scenes/HarborScene.ts', import.meta.url), 'utf8');
  assert.match(source, /ReadyToLeavePulsePresentation/);
  assert.match(source, /#readyToLeavePulse\.observe\(/);
  assert.match(source, /#readyToLeavePulse\.sampleFor\(ship\.ship\.id\)/);
  assert.match(source, /#readyToLeavePulse\.clear\(\)/);
});

test('two ships becoming ready close together keep independent double-pulse signals', () => {
  const ReadyPulse = PulseModule.ReadyToLeavePulsePresentation;
  assert.equal(typeof ReadyPulse, 'function');
  const pulse = new ReadyPulse();

  pulse.observe([
    { id: 'ship-a', state: ShipState.Unloading },
    { id: 'ship-b', state: ShipState.Unloading },
  ]);
  pulse.observe([
    { id: 'ship-a', state: ShipState.ReadyToLeave },
    { id: 'ship-b', state: ShipState.Unloading },
  ]);
  pulse.advance(120);
  pulse.observe([
    { id: 'ship-a', state: ShipState.ReadyToLeave },
    { id: 'ship-b', state: ShipState.ReadyToLeave },
  ]);

  assert.notEqual(pulse.sampleFor('ship-a'), null);
  assert.notEqual(pulse.sampleFor('ship-b'), null);
});
