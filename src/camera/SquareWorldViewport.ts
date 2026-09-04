export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Rect extends Point, Size {}

export interface AxisScale {
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

function assertFinitePoint(point: Point, label: string): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new RangeError(`${label} coordinates must be finite numbers`);
  }
}

export interface DisplayCoordinateContract {
  readonly internalGameSize: Size;
  readonly canvasCssBounds: Rect;
  readonly cssViewport: Size;
  readonly internalToCssScale: AxisScale;
  readonly cssToInternalScale: AxisScale;
  readonly cssObjectScale: AxisScale;
  internalPointToCss(point: Point): Point;
  internalRectToCss(rect: Rect): Rect;
  cssLocalPointToInternal(point: Point): Point;
  worldToCssPixelScale(worldToInternalScale: number): number;
}

export function createDisplayCoordinateContract(input: {
  readonly internalGameSize: Size;
  readonly canvasCssBounds: Rect;
}): DisplayCoordinateContract {
  assertPositiveSize(input.internalGameSize, 'Internal game size');
  assertPositiveSize(input.canvasCssBounds, 'Canvas CSS bounds');
  assertFinitePoint(input.canvasCssBounds, 'Canvas CSS bounds');

  const internalGameSize = Object.freeze({ ...input.internalGameSize });
  const canvasCssBounds = Object.freeze({ ...input.canvasCssBounds });
  const internalToCssScale = Object.freeze({
    x: canvasCssBounds.width / internalGameSize.width,
    y: canvasCssBounds.height / internalGameSize.height,
  });
  const cssToInternalScale = Object.freeze({
    x: 1 / internalToCssScale.x,
    y: 1 / internalToCssScale.y,
  });

  return Object.freeze({
    internalGameSize,
    canvasCssBounds,
    cssViewport: Object.freeze({
      width: canvasCssBounds.width,
      height: canvasCssBounds.height,
    }),
    internalToCssScale,
    cssToInternalScale,
    cssObjectScale: cssToInternalScale,
    internalPointToCss(point: Point): Point {
      assertFinitePoint(point, 'Internal point');
      return {
        x: canvasCssBounds.x + point.x * internalToCssScale.x,
        y: canvasCssBounds.y + point.y * internalToCssScale.y,
      };
    },
    internalRectToCss(rect: Rect): Rect {
      assertPositiveSize(rect, 'Internal rect');
      const origin = this.internalPointToCss(rect);
      return {
        x: origin.x,
        y: origin.y,
        width: rect.width * internalToCssScale.x,
        height: rect.height * internalToCssScale.y,
      };
    },
    cssLocalPointToInternal(point: Point): Point {
      assertFinitePoint(point, 'CSS local point');
      return {
        x: point.x * cssToInternalScale.x,
        y: point.y * cssToInternalScale.y,
      };
    },
    worldToCssPixelScale(worldToInternalScale: number): number {
      if (!Number.isFinite(worldToInternalScale) || worldToInternalScale <= 0) {
        throw new RangeError('World-to-internal scale must be positive and finite');
      }
      return Math.min(internalToCssScale.x, internalToCssScale.y) * worldToInternalScale;
    },
  });
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
