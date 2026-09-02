import Phaser from 'phaser';

import { getLogicalWorldSize } from './config/getLogicalWorldSize.ts';
import { loadBundledConfig } from './config/loadBundledConfig.ts';
import { LocalPlatformAdapter } from './platform/LocalPlatformAdapter.ts';
import { BootstrapScene } from './scenes/BootstrapScene.ts';
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
  scene: [new BootstrapScene(logicalWorld)],
};

async function bootstrap(): Promise<void> {
  await platform.init();
  new Phaser.Game(config);
  await platform.gameReady();
}

void bootstrap();
