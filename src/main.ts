import Phaser from 'phaser';

import { loadBundledConfig } from './config/loadBundledConfig.ts';
import { BootstrapScene } from './scenes/BootstrapScene.ts';
import './styles.css';

loadBundledConfig();

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  width: 1280,
  height: 720,
  backgroundColor: '#0b1720',
  scene: [BootstrapScene],
};

new Phaser.Game(config);
