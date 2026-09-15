import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { SimulationScheduler } from '../src/core/SimulationScheduler.ts';

function ports(order, terminal) {
  const push = (name, result = {}) => () => { order.push(name); return result; };
  return {
    applyCommands: push('commands'),
    spawn: push('spawn'),
    hazards: push('hazards'),
    move: push('move'),
    collision: push('collision', { collision: true }),
    grounding: push('grounding', { grounding: true }),
    applyTerminal: () => { order.push('terminal'); return terminal; },
    docking: push('docking', { docking: true }),
    cargo: push('cargo', { cargo: true }),
    exit: push('exit', { exit: true }),
    objective: push('objective'),
    capture: push('capture'),
    flush: push('flush'),
  };
}

test('AR-04 scheduler freezes the non-terminal fixed-step order', () => {
  const order = [];
  const result = new SimulationScheduler().step(1 / 60, ports(order, false));
  assert.deepEqual(order, [
    'commands', 'spawn', 'hazards', 'move', 'collision', 'grounding', 'terminal',
    'docking', 'cargo', 'exit', 'objective', 'flush', 'capture',
  ]);
  assert.equal(result.terminal, false);
});

test('AR-04 terminal winner suppresses docking, cargo, exit and objective in the same step', () => {
  const order = [];
  const result = new SimulationScheduler().step(1 / 60, ports(order, true));
  assert.deepEqual(order, [
    'commands', 'spawn', 'hazards', 'move', 'collision', 'grounding', 'terminal',
    'flush', 'capture',
  ]);
  assert.equal(result.terminal, true);
  assert.equal(result.docking, null);
  assert.equal(result.cargo, null);
  assert.equal(result.exit, null);
});


test('AR-04 GameSession owns the scheduler and HarborRuntime only supplies simulation ports', () => {
  const sessionSource = readFileSync('src/core/GameSession.ts', 'utf8');
  const runtimeSource = readFileSync('src/runtime/HarborRuntime.ts', 'utf8');
  assert.match(sessionSource, /SimulationScheduler/);
  assert.match(sessionSource, /runSimulationStep/);
  assert.doesNotMatch(runtimeSource, /new SimulationScheduler\(/);
  assert.match(runtimeSource, /#session\.runSimulationStep\(/);
});

test('AR-04 HarborRuntime delegates gameplay phase decisions to a simulation-port adapter', () => {
  const runtimeSource = readFileSync('src/runtime/HarborRuntime.ts', 'utf8');
  assert.match(runtimeSource, /HarborSimulationPorts/);
  assert.doesNotMatch(runtimeSource, /chooseTerminalFailure/);
  assert.doesNotMatch(runtimeSource, /this\.#(?:collision|grounding|docking|cargo|exit)\.(?:step|resolve)\(/);
});
