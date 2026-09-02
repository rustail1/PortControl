import Phaser from 'phaser';

import {
  SquareWorldViewport,
  type Size,
} from '../camera/SquareWorldViewport.ts';

export class BootstrapScene extends Phaser.Scene {
  private readonly squareViewport: SquareWorldViewport;

  public constructor(logicalWorld: Size) {
    super('BootstrapScene');
    this.squareViewport = new SquareWorldViewport(logicalWorld);
  }

  public create(): void {
    const { width, height } = this.squareViewport.logicalWorld;
    this.cameras.main.setBounds(0, 0, width, height);
    this.resizeCamera(this.scale.gameSize);

    this.scale.on(Phaser.Scale.Events.RESIZE, this.resizeCamera, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.resizeCamera, this);
    });
  }

  private resizeCamera(gameSize: Phaser.Structs.Size): void {
    const logicalWorld = this.squareViewport.logicalWorld;
    const layout = this.squareViewport.layout(gameSize);
    const camera = this.cameras.main;

    camera.setViewport(layout.x, layout.y, layout.size, layout.size);
    camera.setZoom(layout.scale);
    camera.centerOn(logicalWorld.width / 2, logicalWorld.height / 2);
  }
}
