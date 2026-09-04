import type { Size } from '../camera/SquareWorldViewport.ts';

export interface HarborUiPoint {
  readonly x: number;
  readonly y: number;
}

export interface HarborUiLayout {
  readonly viewport: Size;
  readonly hud: HarborUiPoint;
  readonly hudMaxWidth: number;
  readonly terminalTitle: HarborUiPoint;
  readonly terminalAction: HarborUiPoint;
}

function assertViewport(viewport: Size): void {
  if (
    !Number.isFinite(viewport.width) ||
    !Number.isFinite(viewport.height) ||
    viewport.width <= 0 ||
    viewport.height <= 0
  ) {
    throw new RangeError('UI viewport must have positive finite dimensions');
  }
}

export function createHarborUiLayout(viewport: Size): HarborUiLayout {
  assertViewport(viewport);
  const margin = 12;
  const centerX = viewport.width / 2;
  const centerY = viewport.height / 2;
  const titleOffset = Math.min(60, Math.max(38, viewport.height * 0.08));
  const actionOffset = Math.min(80, Math.max(58, viewport.height * 0.1));
  return Object.freeze({
    viewport: Object.freeze({ ...viewport }),
    hud: Object.freeze({ x: margin, y: margin }),
    hudMaxWidth: Math.max(120, viewport.width - margin * 2),
    terminalTitle: Object.freeze({
      x: centerX,
      y: Math.max(margin + 70, centerY - titleOffset),
    }),
    terminalAction: Object.freeze({
      x: centerX,
      y: Math.min(viewport.height - margin - 24, centerY + actionOffset),
    }),
  });
}
