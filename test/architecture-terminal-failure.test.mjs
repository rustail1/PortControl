import assert from 'node:assert/strict'; import test from 'node:test';
import { chooseTerminalFailure } from '../src/core/TerminalFailureArbitrator.ts';
test('collision wins same-step terminal arbitration',()=>{const c={shipAId:'a',shipBId:'b',distanceSquared:1,failReason:'collision'};const g={shipId:'g',failReason:'grounding'};assert.equal(chooseTerminalFailure({collision:c,grounding:g}),c);});
test('grounding wins when collision absent',()=>{const g={shipId:'g',failReason:'grounding'};assert.equal(chooseTerminalFailure({collision:null,grounding:g}),g);});
