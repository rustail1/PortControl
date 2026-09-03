import Phaser from 'phaser';

import { getLogicalWorldSize } from './config/getLogicalWorldSize.ts';
import { loadBundledConfig } from './config/loadBundledConfig.ts';
import { LocalPlatformAdapter } from './platform/LocalPlatformAdapter.ts';
import { HarborScene } from './scenes/HarborScene.ts';
import './styles.css';

const configBundle = loadBundledConfig();
const logicalWorld = getLogicalWorldSize(configBundle);

const platform = new LocalPlatformAdapter();

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
  scene: [new HarborScene(logicalWorld, configBundle, 'calm_07')],
};

async function bootstrap(): Promise<void> {
  await platform.init();
  new Phaser.Game(config);

  if (import.meta.env.DEV) {
    const { DebugOverlay, unavailableDebugSnapshot } = await import(
      './debug/DebugOverlay.ts'
    );
    const debugOverlay = new DebugOverlay({
      getDebugSnapshot: () => unavailableDebugSnapshot,
    });
    debugOverlay.mount();
  }

  await platform.gameReady();
}

void bootstrap();
