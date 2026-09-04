import Phaser from 'phaser';

import { getLogicalWorldSize } from './config/getLogicalWorldSize.ts';
import { loadBundledConfig } from './config/loadBundledConfig.ts';
import { LocalPlatformAdapter } from './platform/LocalPlatformAdapter.ts';
import { resolveDevelopmentLevelId } from './scenes/HarborLevelSelection.ts';
import { HarborScene } from './scenes/HarborScene.ts';
import './styles.css';

const configBundle = loadBundledConfig();
const logicalWorld = getLogicalWorldSize(configBundle);

const platform = new LocalPlatformAdapter();
const levelId = resolveDevelopmentLevelId(globalThis.location.search, configBundle.levels);

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  backgroundColor: '#0b1720',
  scale: {
    parent: 'game',
    mode: Phaser.Scale.EXPAND,
    width: logicalWorld.width,
    height: logicalWorld.height,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    expandParent: true,
  },
  scene: [new HarborScene(logicalWorld, configBundle, levelId)],
};

async function bootstrap(): Promise<void> {
  await platform.init();
  const game = new Phaser.Game(config);

  if (import.meta.env.DEV) {
    Object.assign(globalThis, {
      __PORT_CONTROL_SMOKE__: Object.freeze({
        getSnapshot: () => {
          const scene = game.scene.getScene('HarborScene');
          return scene instanceof HarborScene ? scene.browserSmokeSnapshot() : null;
        },
      }),
    });
  }

  await platform.gameReady();
}

void bootstrap();
