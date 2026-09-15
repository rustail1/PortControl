import assert from 'node:assert/strict'; import test from 'node:test'; import { readFileSync } from 'node:fs';
test('ship views track route dirty signature',()=>{assert.match(readFileSync('src/scenes/HarborScene.ts','utf8'),/routeSignature/);});
