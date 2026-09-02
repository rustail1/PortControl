import Phaser from 'phaser';

import { loadBundledConfig } from './config/loadBundledConfig.ts';
import { LocalPlatformAdapter } from './platform/LocalPlatformAdapter.ts';
import { BootstrapScene } from './scenes/BootstrapScene.ts';
import './styles.css';

loadBundledConfig();

const platform = new LocalPlatformAdapter();

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  width: 1280,
  height: 720,
  backgroundColor: '#0b1720',
  scene: [BootstrapScene],
};

async function bootstrap(): Promise<void> {
  await platform.init();
  new Phaser.Game(config);
  await platform.gameReady();
}

void bootstrap();
