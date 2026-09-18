type Zone = { id: string; name: string; kind: string; points: number[][]; sentido?: string };
type Point = number[];
const side = (a: Point, b: Point, p: Point) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
export function inside(point: Point, polygon: Point[]) {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [x, y] = polygon[i], [xx, yy] = polygon[j];
    if ((y > point[1]) !== (yy > point[1]) && point[0] < (xx - x) * (point[1] - y) / (yy - y) + x) result = !result;
  }
  return result;
}
export function testTrajectory(previous: Point | null, current: Point, zones: Zone[]) {
  if (zones.some((z) => z.kind === 'exclude' && inside(current, z.points))) return [];
  const includes = zones.filter((z) => z.kind === 'include');
  if (includes.length && !includes.some((z) => inside(current, z.points))) return [];
  return zones.filter((zone) => {
    if (zone.kind === 'include') return inside(current, zone.points) && (!previous || !inside(previous, zone.points));
    if (zone.kind !== 'line' || !previous || zone.points.length !== 2) return false;
    const [a, b] = zone.points;
    const before = side(a, b, previous), after = side(a, b, current);
    if (Math.abs(before) < 1e-9 && Math.abs(after) < 1e-9) return false;
    if (Math.sign(before) === Math.sign(after)) return false;
    if (Math.sign(side(previous, current, a)) === Math.sign(side(previous, current, b))) return false;
    const direction = before < 0 ? 'ab' : 'ba';
    return !zone.sentido || zone.sentido === 'ambos' || zone.sentido === direction;
  }).map((z) => z.name);
}
