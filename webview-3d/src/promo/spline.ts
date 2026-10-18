/**
 * Smooth camera paths: a cubic Hermite spline through timed keys with Catmull-Rom tangents
 * (velocity continuous through every key; a `hold` key arrives and leaves at rest). Pure, so the
 * unit test pins it. No linear moves: every segment starts and ends on a smooth tangent.
 */
export interface SplineKey {
  t: number;
  v: readonly number[];
  /** Zero velocity here (the start and end of the path always are). */
  hold?: boolean;
}

function tangent(keys: readonly SplineKey[], i: number, c: number): number {
  if (keys[i]!.hold || i === 0 || i === keys.length - 1) return 0;
  const a = keys[i - 1]!;
  const b = keys[i + 1]!;
  return (b.v[c]! - a.v[c]!) / (b.t - a.t);
}

/** The path's value at time t (clamped to the first and last key). */
export function evalSpline(keys: readonly SplineKey[], t: number): number[] {
  const first = keys[0]!;
  const last = keys[keys.length - 1]!;
  if (t <= first.t) return [...first.v];
  if (t >= last.t) return [...last.v];
  let i = 0;
  while (keys[i + 1]!.t < t) i++;
  const k0 = keys[i]!;
  const k1 = keys[i + 1]!;
  const h = k1.t - k0.t;
  const s = (t - k0.t) / h;
  const s2 = s * s;
  const s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1;
  const h10 = s3 - 2 * s2 + s;
  const h01 = -2 * s3 + 3 * s2;
  const h11 = s3 - s2;
  return k0.v.map(
    (p0, c) =>
      h00 * p0 + h10 * h * tangent(keys, i, c) + h01 * k1.v[c]! + h11 * h * tangent(keys, i + 1, c),
  );
}
