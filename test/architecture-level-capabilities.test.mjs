import assert from 'node:assert/strict'; import test from 'node:test';
import { toLevelDefinition } from '../src/config/LevelDefinition.ts'; import { missingCapabilities } from '../src/config/RuntimeCapabilities.ts';
test('capabilities derive from blocks, not level ids',()=>{const level=toLevelDefinition({id:'anything',allowedShips:[],layout:{blocks:[{blockType:'current_zone',enabled:true},{blockType:'storm_path'}]}});assert.deepEqual(missingCapabilities(level),['current-zone','storm-path']);});
