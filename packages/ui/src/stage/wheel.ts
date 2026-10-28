// What a wheel event means on the Stage. Browsers do not say which device sent
// it, so: ctrl+wheel is how trackpads report a pinch; line/page deltas and
// wheelDelta in multiples of 120 are mouse notches; the rest is two-finger
// scrolling. Pinch and mouse wheel zoom, two-finger scroll pans.
export type WheelIntent = 'pinch' | 'zoom' | 'pan';

export type WheelLike = {
  ctrlKey: boolean;
  deltaMode: number;
  deltaX: number;
  deltaY: number;
  /** Chrome/Safari legacy field; mice report multiples of 120. */
  wheelDeltaY?: number;
};

export function wheelIntent(e: WheelLike): WheelIntent {
  if (e.ctrlKey) return 'pinch';
  if (e.deltaMode !== 0) return 'zoom';
  const legacy = e.wheelDeltaY;
  if (legacy !== undefined && legacy !== 0 && e.deltaX === 0 && Math.abs(legacy) % 120 === 0)
    return 'zoom';
  return 'pan';
}

/** WebKit reports a pinch as gesture events with a cumulative `scale`; the step since the last one. */
export function gestureFactor(scale: number, previous: number): number {
  if (!(scale > 0) || !(previous > 0)) return 1;
  return scale / previous;
}
