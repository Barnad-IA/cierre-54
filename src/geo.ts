import proj4 from 'proj4';
import { DOMParser } from '@xmldom/xmldom';
import { difference, intersection, union } from 'polyclip-ts';
import { fenceJoin } from './fence';
import type { Item, Point, Ring, Terrain, Zone } from './types';

proj4.defs('EPSG:32618', '+proj=utm +zone=18 +datum=WGS84 +units=m +no_defs');
export function utm(lon: number, lat: number): Point {
  const [e, n] = proj4('EPSG:4326', 'EPSG:32618', [lon, lat]);
  return [e, n];
}
export const distance = (a: Point, b: Point) => Math.hypot(b[0] - a[0], b[1] - a[1]);
export function ringArea(r: Ring) {
  return Math.abs(r.reduce((sum, a, i) => {
    const b = r[(i + 1) % r.length];
    return sum + a[0] * b[1] - b[0] * a[1];
  }, 0)) / 2;
}
export const perimeter = (r: Ring) => r.reduce((sum, p, i) => sum + distance(p, r[(i + 1) % r.length]), 0);
export type Surface = Ring[][];
export const surfaceArea = (shape: Surface) => shape.reduce((sum, [outer, ...holes]) => sum + ringArea(outer) - holes.reduce((n, r) => n + ringArea(r), 0), 0);
const epsilon = 1e-6;
const cross = (a: Point, b: Point, c: Point) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function onSegment(a: Point, b: Point, c: Point) {
  return Math.abs(cross(a, b, c)) < epsilon && c.every((v, i) => v >= Math.min(a[i], b[i]) - epsilon && v <= Math.max(a[i], b[i]) + epsilon);
}
function intersects(a: Point, b: Point, c: Point, d: Point) {
  return onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b) ||
    (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0);
}
export function validateRing(r: Ring) {
  if (r.length < 3 || ringArea(r) < epsilon) throw new Error('El polígono requiere tres puntos y una superficie positiva.');
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length];
    if (distance(a, b) < epsilon) throw new Error('El polígono contiene vértices consecutivos repetidos.');
    for (let j = i + 2; j < r.length; j++) {
      if (i === 0 && j === r.length - 1) continue;
      if (intersects(a, b, r[j], r[(j + 1) % r.length])) throw new Error('El polígono se cruza o se toca a sí mismo.');
    }
  }
}
function kmlDocument(xml: string) {
  const doc = new DOMParser({ onError: (level) => { if (level !== 'warning') throw new Error('XML KML inválido.'); } }).parseFromString(xml, 'application/xml');
  if (doc.documentElement?.localName !== 'kml') throw new Error('El archivo debe tener un elemento raíz KML.');
  return doc;
}
function projectCoordinates(coords: string) {
  return coords.trim().split(/\s+/).map(entry => {
    const fields = entry.split(',');
    const [lon,lat,alt] = fields.map(Number);
    if (fields.length < 2 || fields.length > 3 || fields.some(v => !v || !Number.isFinite(Number(v))) || lon < -78 || lon > -72 || lat < 0 || lat > 84) {
      throw new Error('Coordenadas inválidas para WGS84 / UTM 18N.');
    }
    return { p:utm(lon,lat), alt:alt ?? null };
  });
}
export function parseLengthKml(xml: string, origin: Point): Point[] {
  const lines = kmlDocument(xml).getElementsByTagNameNS('*','LineString');
  if (lines.length !== 1) throw new Error('Exporta «largo» como un KML con un solo LineString.');
  const coords = lines.item(0)?.getElementsByTagNameNS('*','coordinates').item(0)?.textContent?.trim();
  if (!coords) throw new Error('La línea carece de coordenadas.');
  const points = projectCoordinates(coords).map(({ p }): Point => [p[0]-origin[0],p[1]-origin[1]]);
  if (points.length < 2 || points.every(p => distance(p,points[0]) < epsilon)) throw new Error('La línea requiere dos puntos distintos.');
  return points;
}
export function parseKml(xml: string, name: string): Terrain {
  const doc = kmlDocument(xml);
  const polygons = doc.getElementsByTagNameNS('*', 'Polygon');
  if (polygons.length !== 1) throw new Error('Se requiere un KML con exactamente un Polygon para el terreno.');
  const polygon = polygons.item(0)!;
  const outer = polygon.getElementsByTagNameNS('*', 'outerBoundaryIs').item(0);
  const inner = polygon.getElementsByTagNameNS('*', 'innerBoundaryIs');
  const boundaries = [outer, ...Array.from({ length: inner.length }, (_, i) => inner.item(i))];
  const raw = boundaries.map(boundary => {
    const coords = boundary?.getElementsByTagNameNS('*', 'LinearRing').item(0)?.getElementsByTagNameNS('*', 'coordinates').item(0)?.textContent?.trim();
    if (!coords) throw new Error('Faltan las coordenadas del LinearRing.');
    const points = projectCoordinates(coords);
    if (points.length > 1 && distance(points[0].p, points.at(-1)!.p) < epsilon) points.pop();
    return points;
  });
  const origin = raw[0][0].p;
  const rings = raw.map(r => r.map(({ p }): Point => [p[0] - origin[0], p[1] - origin[1]]));
  validateTerrain(rings);
  return { name, provisional: false, origin, rings, altitudes: raw.map(r => r.map(p => p.alt)) };
}
export function validateTerrain(rings: Ring[]) {
  if (!rings.length) throw new Error('Falta el perímetro.');
  rings.forEach(validateRing);
  for (let i = 1; i < rings.length; i++) {
    const hole = rings[i];
    if (surfaceArea(difference([hole], [rings[0]])) > epsilon ||
        rings.slice(0, i).some(ring => ring.some((p, j) => hole.some((q, k) =>
          intersects(p, ring[(j + 1) % ring.length], q, hole[(k + 1) % hole.length])))) ||
        rings.slice(1, i).some(ring => surfaceArea(intersection([ring], [hole])) > epsilon)) {
      throw new Error('Los huecos deben quedar dentro del perímetro y separados entre sí.');
    }
  }
}
export function bounds(points: Ring) {
  return points.reduce(([l,b,r,t], [x,y]) => [Math.min(l,x), Math.min(b,y), Math.max(r,x), Math.max(t,y)],
    [Infinity, Infinity, -Infinity, -Infinity]);
}
export function footprint(item: Pick<Item, 'x' | 'y' | 'w' | 'd' | 'rotation'>): Ring {
  const { x, y, w, d, rotation } = item;
  const a = rotation * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return [[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]].map(([u,v]) => [x + u*c - v*s, y + u*s + v*c]);
}
export const snapTo = (value: number, step: number) => step ? Number((Math.round(value / step) * step).toFixed(8)) : value;
function pointSegment(p: Point, a: Point, b: Point) {
  const [x,y] = [b[0]-a[0], b[1]-a[1]];
  const t = Math.max(0, Math.min(1, ((p[0]-a[0])*x + (p[1]-a[1])*y) / (x*x+y*y)));
  return distance(p, [a[0]+t*x, a[1]+t*y]);
}
export function gap(a: Ring, b: Ring) {
  if (surfaceArea(intersection([a], [b])) > epsilon) return 0;
  return Math.min(...a.flatMap((p,i) => b.map((q,j) => {
    const p2 = a[(i+1)%a.length], q2 = b[(j+1)%b.length];
    return intersects(p,p2,q,q2) ? 0 : Math.min(pointSegment(p,q,q2), pointSegment(q,p,p2));
  })));
}
const merge = (shapes: Surface[]): Surface => shapes.length ? union(shapes[0], ...shapes.slice(1)) : [];
export function analyze(terrain: Terrain, zones: Zone[], items: Item[]) {
  const site: Surface = [terrain.rings];
  const authorized = merge(zones.filter(z => z.kind === 'Autorizada').map(z => [[z.ring]]));
  const blocking = merge(zones.filter(z => z.kind !== 'Autorizada').map(z => [[z.ring]]));
  const approved = authorized.length ? intersection(site, authorized) : [];
  const usable = approved.length && blocking.length ? difference(approved, blocking) : approved;
  const footprints = items.filter(i => i.w > 0 && i.d > 0).map(item => ({ item, shape: [[footprint(item)]] as Surface }));
  const alerts: Record<string, string[]> = Object.fromEntries(items.map(i => [i.id, []]));
  items.filter(i => !(i.w > 0 && i.d > 0)).forEach(i => alerts[i.id].push('Faltan dimensiones de la huella.'));
  footprints.forEach(({ item, shape }, index) => {
    const { id } = item;
    if (surfaceArea(difference(shape, site)) > epsilon) alerts[id].push('Fuera del perímetro.');
    if (!authorized.length) alerts[id].push('Sin zona autorizada definida.');
    else if (surfaceArea(difference(shape, approved)) > epsilon) alerts[id].push('Fuera de zona autorizada.');
    if (blocking.length && surfaceArea(intersection(shape, blocking)) > epsilon) alerts[id].push('Invade una zona reservada o excluida.');
    for (const other of footprints.slice(0, index)) {
      if (fenceJoin(other.item,item) || fenceJoin(item,other.item) || surfaceArea(intersection(shape, other.shape)) <= epsilon) continue;
      alerts[id].push('Choque con ' + other.item.name + '.');
      alerts[other.item.id].push('Choque con ' + item.name + '.');
    }
  });
  const occupied = merge(footprints.map(f => f.shape));
  return {
    alerts, site: surfaceArea(site), occupied: surfaceArea(occupied),
    blocked: blocking.length ? surfaceArea(intersection(site, blocking)) : 0,
    usable: surfaceArea(usable),
    free: usable.length && occupied.length ? surfaceArea(difference(usable, occupied)) : surfaceArea(usable),
  };
}

