export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface SquarePlayfieldLayout {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly scale: number;
}

function assertPositiveSize(size: Size, label: string): void {
  if (
    !Number.isFinite(size.width) ||
    !Number.isFinite(size.height) ||
    size.width <= 0 ||
    size.height <= 0
  ) {
    throw new RangeError(`${label} dimensions must be positive finite numbers`);
  }
}

export class SquareWorldViewport {
  public readonly logicalWorld: Size;

  public constructor(logicalWorld: Size) {
    assertPositiveSize(logicalWorld, 'Logical world');
    if (logicalWorld.width !== logicalWorld.height) {
      throw new RangeError('Logical world must be square');
    }

    this.logicalWorld = Object.freeze({ ...logicalWorld });
  }

  public layout(viewport: Size): SquarePlayfieldLayout {
    assertPositiveSize(viewport, 'Viewport');
    const size = Math.min(viewport.width, viewport.height);

    return {
      x: (viewport.width - size) / 2,
      y: (viewport.height - size) / 2,
      size,
      scale: size / this.logicalWorld.width,
    };
  }

  public screenToWorld(point: Point, viewport: Size): Point | null {
    const layout = this.layout(viewport);
    const localX = point.x - layout.x;
    const localY = point.y - layout.y;

    if (
      localX < 0 ||
      localY < 0 ||
      localX > layout.size ||
      localY > layout.size
    ) {
      return null;
    }

    return {
      x: (localX * this.logicalWorld.width) / layout.size,
      y: (localY * this.logicalWorld.height) / layout.size,
    };
  }

  public worldToScreen(point: Point, viewport: Size): Point {
    const layout = this.layout(viewport);
    return {
      x: layout.x + (point.x * layout.size) / this.logicalWorld.width,
      y: layout.y + (point.y * layout.size) / this.logicalWorld.height,
    };
  }
}
