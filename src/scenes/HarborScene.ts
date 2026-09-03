import Phaser from 'phaser';

import type { Size } from '../camera/SquareWorldViewport.ts';
import { SquareWorldViewport } from '../camera/SquareWorldViewport.ts';
import type { ConfigBundle } from '../config/types.ts';
import {
  HarborRuntime,
  selectNextAttemptSeed,
  type AttemptSeedProvider,
  type HarborPresentationSnapshot,
  type HarborShipPresentationSnapshot,
} from '../runtime/HarborRuntime.ts';
import { ShipState } from '../ships/ShipState.ts';

interface ShipView {
  readonly body: Phaser.GameObjects.Graphics;
  readonly route: Phaser.GameObjects.Graphics;
  readonly label: Phaser.GameObjects.Text;
  routePoints: readonly { readonly x: number; readonly y: number }[] | null;
}

const PROTOTYPE_LEVEL_ID = 'calm_07';

function cssColorToNumber(value: string, fallback: number): number {
  const parsed = Number.parseInt(value.replace('#', ''), 16);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function interpolateAngleDegrees(
  previous: number,
  current: number,
  alpha: number,
): number {
  const delta = ((current - previous + 540) % 360) - 180;
  return previous + delta * alpha;
}

export function createCryptoAttemptSeed(): number {
  const values = new Uint32Array(1);
  globalThis.crypto.getRandomValues(values);
  const value = values[0];
  if (value === undefined) {
    throw new Error('crypto seed provider returned no value');
  }
  return value;
}

export class HarborScene extends Phaser.Scene {
  readonly #logicalWorld: Size;
  readonly #bundle: ConfigBundle;
  readonly #levelId: string;
  readonly #seedProvider: AttemptSeedProvider;
  readonly #squareViewport: SquareWorldViewport;
  readonly #shipViews = new Map<string, ShipView>();
  #runtime: HarborRuntime | null = null;
  #staticGraphics: Phaser.GameObjects.Graphics | null = null;
  #overlayGraphics: Phaser.GameObjects.Graphics | null = null;
  #draftGraphics: Phaser.GameObjects.Graphics | null = null;
  #hud: Phaser.GameObjects.Text | null = null;
  #terminalTitle: Phaser.GameObjects.Text | null = null;
  #terminalButton: Phaser.GameObjects.Text | null = null;
  #pageBestScore = 0;
  #terminalResultSeen = false;

  public constructor(
    logicalWorld: Size,
    bundle: ConfigBundle,
    levelId = PROTOTYPE_LEVEL_ID,
    seedProvider: AttemptSeedProvider = createCryptoAttemptSeed,
  ) {
    super('HarborScene');
    this.#logicalWorld = logicalWorld;
    this.#bundle = bundle;
    this.#levelId = levelId;
    this.#seedProvider = seedProvider;
    this.#squareViewport = new SquareWorldViewport(logicalWorld);
  }

  public create(): void {
    const { width, height } = this.#logicalWorld;
    this.cameras.main.setBounds(0, 0, width, height);
    this.#resizeCamera(this.scale.gameSize);
    this.#startAttempt(this.#seedProvider());

    this.scale.on(Phaser.Scale.Events.RESIZE, this.#onResize, this);
    this.input.on('pointerdown', this.#onPointerDown, this);
    this.input.on('pointermove', this.#onPointerMove, this);
    this.input.on('pointerup', this.#onPointerUp, this);
    this.input.on('pointerupoutside', this.#onPointerUp, this);

    document.addEventListener('visibilitychange', this.#onVisibilityChange);
    window.addEventListener('blur', this.#onWindowBlur);
    window.addEventListener('focus', this.#onWindowFocus);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.#onResize, this);
      this.input.off('pointerdown', this.#onPointerDown, this);
      this.input.off('pointermove', this.#onPointerMove, this);
      this.input.off('pointerup', this.#onPointerUp, this);
      this.input.off('pointerupoutside', this.#onPointerUp, this);
      document.removeEventListener('visibilitychange', this.#onVisibilityChange);
      window.removeEventListener('blur', this.#onWindowBlur);
      window.removeEventListener('focus', this.#onWindowFocus);
      this.#destroyShipViews();
    });
  }

  public update(_time: number, delta: number): void {
    const runtime = this.#runtime;
    if (runtime === null) {
      return;
    }
    const advance = runtime.advanceRender(delta);
    this.#render(runtime.presentationSnapshot(), advance.interpolationAlpha);
  }

  #startAttempt(seed: number): void {
    this.#destroyShipViews();
    this.#clearTerminal();
    this.#terminalResultSeen = false;
    this.#runtime = new HarborRuntime({
      bundle: this.#bundle,
      levelId: this.#levelId,
      attemptSeed: seed,
    });
    this.#rebuildStaticWorld(this.#runtime.presentationSnapshot());
    this.#overlayGraphics ??= this.add.graphics().setDepth(20);
    this.#draftGraphics ??= this.add.graphics().setDepth(15);
    this.#hud ??= this.add
      .text(16, 16, '', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#ffffff',
        backgroundColor: '#17324dcc',
        padding: { x: 8, y: 6 },
      })
      .setScrollFactor(0)
      .setDepth(100);
  }

  #rebuildStaticWorld(snapshot: HarborPresentationSnapshot): void {
    this.#staticGraphics?.destroy();
    const graphics = this.add.graphics().setDepth(0);
    const visual = this.#bundle.configs['balance.json'] as {
      readonly visual?: { readonly worldBackground?: string };
    };
    graphics.fillStyle(
      cssColorToNumber(visual.visual?.worldBackground ?? '', 0x2f8fb3),
      1,
    );
    graphics.fillRect(0, 0, this.#logicalWorld.width, this.#logicalWorld.height);

    graphics.fillStyle(0x8c866f, 1);
    for (const polygon of snapshot.land) {
      const first = polygon.points[0];
      if (first === undefined) {
        continue;
      }
      graphics.beginPath();
      graphics.moveTo(first.x, first.y);
      for (let index = 1; index < polygon.points.length; index += 1) {
        const point = polygon.points[index];
        if (point !== undefined) {
          graphics.lineTo(point.x, point.y);
        }
      }
      graphics.closePath();
      graphics.fillPath();
    }

    graphics.lineStyle(3, 0xe6d38a, 0.9);
    for (const dock of snapshot.docks) {
      const { position } = dock.definition;
      graphics.strokeRect(position.x - 34, position.y - 18, 68, 36);
      graphics.lineBetween(position.x, position.y, position.x, position.y - 28);
    }

    graphics.lineStyle(2, 0xffffff, 0.45);
    for (const exit of snapshot.exits) {
      graphics.strokeRect(
        exit.x - exit.width / 2,
        exit.y - exit.height / 2,
        exit.width,
        exit.height,
      );
    }

    graphics.lineStyle(1, 0xd9f2ff, 0.18);
    for (const spawnPoint of snapshot.spawnPoints) {
      graphics.strokeCircle(spawnPoint.x, spawnPoint.y, 8);
    }
    this.#staticGraphics = graphics;
  }

  #render(snapshot: HarborPresentationSnapshot, alpha: number): void {
    this.#renderShips(snapshot, alpha);
    this.#renderOverlay(snapshot);
    this.#renderHud(snapshot);
    if (snapshot.result !== null && !this.#terminalResultSeen) {
      this.#terminalResultSeen = true;
      this.#pageBestScore = Math.max(this.#pageBestScore, snapshot.result.score);
      this.#showTerminal(snapshot);
    }
  }

  #renderShips(snapshot: HarborPresentationSnapshot, alpha: number): void {
    const alive = new Set<string>();
    for (const ship of snapshot.ships) {
      alive.add(ship.ship.id);
      let view = this.#shipViews.get(ship.ship.id);
      if (view === undefined) {
        view = this.#createShipView(ship);
        this.#shipViews.set(ship.ship.id, view);
      }
      const x = ship.previousPosition.x +
        (ship.ship.position.x - ship.previousPosition.x) * alpha;
      const y = ship.previousPosition.y +
        (ship.ship.position.y - ship.previousPosition.y) * alpha;
      const rotation = interpolateAngleDegrees(
        ship.previousRotationDeg,
        ship.ship.rotationDeg,
        alpha,
      );
      view.body.setPosition(x, y).setRotation(Phaser.Math.DegToRad(rotation));
      const cargoTotal = Object.values(ship.ship.cargo).reduce(
        (total, quantity) => total + quantity,
        0,
      );
      view.label
        .setPosition(x, y + 28)
        .setText(
          ship.ship.state === ShipState.ReadyToLeave
            ? `OUT · ${ship.ship.shipType}`
            : `${ship.ship.shipType} · ${ship.ship.state} · C${cargoTotal}`,
        );

      const routePoints = ship.ship.route?.points ?? null;
      if (routePoints !== view.routePoints) {
        view.routePoints = routePoints;
        view.route.clear();
        if (routePoints !== null && routePoints.length > 0) {
          view.route.lineStyle(5, 0xf7fafc, 0.65);
          view.route.beginPath();
          view.route.moveTo(ship.ship.position.x, ship.ship.position.y);
          for (const point of routePoints) {
            view.route.lineTo(point.x, point.y);
          }
          view.route.strokePath();
        }
      }
    }

    for (const [shipId, view] of this.#shipViews) {
      if (!alive.has(shipId)) {
        view.body.destroy();
        view.route.destroy();
        view.label.destroy();
        this.#shipViews.delete(shipId);
      }
    }
  }

  #createShipView(ship: HarborShipPresentationSnapshot): ShipView {
    const body = this.add.graphics().setDepth(10);
    const type = ship.ship.shipType;
    if (type === 'speedboat') {
      body.fillStyle(0xf6f2df, 1);
      body.fillTriangle(18, 0, -14, -7, -14, 7);
      body.lineStyle(2, 0x17324d, 1);
      body.strokeTriangle(18, 0, -14, -7, -14, 7);
    } else if (type === 'freighter') {
      body.fillStyle(0xc9d2d8, 1);
      body.fillRect(-30, -10, 48, 20);
      body.fillTriangle(30, 0, 18, -10, 18, 10);
    } else {
      body.fillStyle(0xf0c36a, 1);
      body.fillRect(-20, -9, 30, 18);
      body.fillTriangle(22, 0, 10, -9, 10, 9);
    }
    body.fillStyle(0x17324d, 1);
    body.fillCircle(10, 0, 2.5);

    const route = this.add.graphics().setDepth(5);
    const label = this.add
      .text(0, 0, '', {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#ffffff',
        backgroundColor: '#17324d99',
      })
      .setOrigin(0.5, 0)
      .setDepth(11);
    return { body, route, label, routePoints: null };
  }

  #renderOverlay(snapshot: HarborPresentationSnapshot): void {
    const graphics = this.#overlayGraphics;
    if (graphics === null) {
      return;
    }
    graphics.clear();

    graphics.lineStyle(3, 0xf5a623, 0.95);
    for (const pair of snapshot.dangerPairs) {
      const first = snapshot.ships.find((ship) => ship.ship.id === pair.shipAId);
      const second = snapshot.ships.find((ship) => ship.ship.id === pair.shipBId);
      if (first !== undefined && second !== undefined) {
        graphics.lineBetween(
          first.ship.position.x,
          first.ship.position.y,
          second.ship.position.x,
          second.ship.position.y,
        );
        graphics.strokeCircle(first.ship.position.x, first.ship.position.y, 24);
        graphics.strokeCircle(second.ship.position.x, second.ship.position.y, 24);
      }
    }

    graphics.lineStyle(3, 0xffffff, 0.85);
    for (const incoming of snapshot.incoming) {
      graphics.strokeCircle(incoming.x, incoming.y, 18);
      const radians = Phaser.Math.DegToRad(incoming.directionDeg);
      graphics.lineBetween(
        incoming.x,
        incoming.y,
        incoming.x + Math.cos(radians) * 34,
        incoming.y + Math.sin(radians) * 34,
      );
    }

    graphics.fillStyle(0x17324d, 0.65);
    for (const dock of snapshot.docks) {
      if (dock.runtime.occupiedBy !== null || dock.runtime.reservedBy !== null) {
        const { position } = dock.definition;
        graphics.fillRect(position.x - 30, position.y - 14, 60, 28);
      }
    }
  }

  #renderHud(snapshot: HarborPresentationSnapshot): void {
    const hud = this.#hud;
    if (hud === null) {
      return;
    }
    const objective = snapshot.objective;
    hud.setText([
      `${snapshot.levelId}`,
      `${objective.type}: ${Math.min(objective.current, objective.target)}/${objective.target}`,
      `Score ${snapshot.score} · Best ${this.#pageBestScore}`,
      `Warnings ${snapshot.warningCount}`,
    ]);
  }

  #showTerminal(snapshot: HarborPresentationSnapshot): void {
    const result = snapshot.result;
    if (result === null) {
      return;
    }
    const width = this.scale.gameSize.width;
    const height = this.scale.gameSize.height;
    const failed = result.kind === 'failed';
    const title = failed
      ? `GAME OVER\n${result.failReason.toUpperCase()}\nScore ${result.score}`
      : `COMPLETED\nStars ${result.earnedStars}/3\nScore ${result.score}`;
    this.#terminalTitle = this.add
      .text(width / 2, height / 2 - 45, title, {
        fontFamily: 'monospace',
        fontSize: '26px',
        align: 'center',
        color: '#ffffff',
        backgroundColor: '#17324de6',
        padding: { x: 22, y: 18 },
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(200);
    this.#terminalButton = this.add
      .text(width / 2, height / 2 + 65, failed ? 'RESTART' : 'PLAY AGAIN', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#17324d',
        backgroundColor: '#f7f3e9',
        padding: { x: 18, y: 10 },
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(201)
      .setInteractive({ useHandCursor: true });
    this.#terminalButton.on(
      'pointerdown',
      (
        _pointer: Phaser.Input.Pointer,
        _localX: number,
        _localY: number,
        event: Phaser.Types.Input.EventData,
      ) => {
        event.stopPropagation();
        const runtime = this.#runtime;
        if (runtime === null || runtime.presentationSnapshot().result === null) {
          return;
        }
        const nextSeed = selectNextAttemptSeed(
          runtime.presentationSnapshot().result!,
          runtime.attemptSeed,
          this.#seedProvider,
        );
        this.#startAttempt(nextSeed);
      },
    );
  }

  #clearTerminal(): void {
    this.#terminalTitle?.destroy();
    this.#terminalButton?.destroy();
    this.#terminalTitle = null;
    this.#terminalButton = null;
  }

  #destroyShipViews(): void {
    for (const view of this.#shipViews.values()) {
      view.body.destroy();
      view.route.destroy();
      view.label.destroy();
    }
    this.#shipViews.clear();
    this.#draftGraphics?.clear();
    this.#overlayGraphics?.clear();
  }

  #pointerInput(pointer: Phaser.Input.Pointer) {
    return {
      source: pointer.wasTouch ? ('touch' as const) : ('mouse' as const),
      pointerId: pointer.id,
      screenPosition: { x: pointer.x, y: pointer.y },
      viewport: {
        width: this.scale.gameSize.width,
        height: this.scale.gameSize.height,
      },
    };
  }

  #onPointerDown(pointer: Phaser.Input.Pointer): void {
    const runtime = this.#runtime;
    if (runtime === null || runtime.presentationSnapshot().result !== null) {
      return;
    }
    runtime.pointerDown(this.#pointerInput(pointer));
    this.#renderActiveDraft();
  }

  #onPointerMove(pointer: Phaser.Input.Pointer): void {
    const runtime = this.#runtime;
    if (runtime === null || !pointer.isDown) {
      return;
    }
    runtime.pointerMove(this.#pointerInput(pointer));
    this.#renderActiveDraft();
  }

  #onPointerUp(pointer: Phaser.Input.Pointer): void {
    const runtime = this.#runtime;
    if (runtime === null) {
      return;
    }
    runtime.pointerUp(this.#pointerInput(pointer));
    this.#renderActiveDraft();
  }

  #renderActiveDraft(): void {
    const graphics = this.#draftGraphics;
    const runtime = this.#runtime;
    if (graphics === null || runtime === null) {
      return;
    }
    graphics.clear();
    const draft = runtime.presentationSnapshot().activeDraft;
    if (draft === null || draft.points.length === 0) {
      return;
    }
    const selected = runtime
      .presentationSnapshot()
      .ships.find((ship) => ship.ship.id === draft.shipId);
    if (selected === undefined) {
      return;
    }
    graphics.lineStyle(5, 0xfff0a6, 1);
    graphics.beginPath();
    graphics.moveTo(selected.ship.position.x, selected.ship.position.y);
    for (const point of draft.points) {
      graphics.lineTo(point.x, point.y);
    }
    graphics.strokePath();
  }

  #onResize(gameSize: Phaser.Structs.Size): void {
    this.#runtime?.cancelActiveDraft();
    this.#draftGraphics?.clear();
    this.#resizeCamera(gameSize);
  }

  #resizeCamera(gameSize: Phaser.Structs.Size): void {
    const layout = this.#squareViewport.layout(gameSize);
    const camera = this.cameras.main;
    camera.setViewport(layout.x, layout.y, layout.size, layout.size);
    camera.setZoom(layout.scale);
    camera.centerOn(this.#logicalWorld.width / 2, this.#logicalWorld.height / 2);
  }

  readonly #onVisibilityChange = (): void => {
    this.#runtime?.setPageActive(!document.hidden);
    if (document.hidden) {
      this.#draftGraphics?.clear();
    }
  };

  readonly #onWindowBlur = (): void => {
    this.#runtime?.setPageActive(false);
    this.#draftGraphics?.clear();
  };

  readonly #onWindowFocus = (): void => {
    if (!document.hidden) {
      this.#runtime?.setPageActive(true);
    }
  };
}
