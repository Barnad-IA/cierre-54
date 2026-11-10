import { distance } from './geo';
import { calibrate } from './ortho';
import type { Point, Terrain } from './types';

const origin: Point = [446180.91399708757,1148610.1716806618];
const controls = [[0,66,270],[1,73,328],[4,365,274],[9,943,72],[10,919,32],[21,362,177]];
const trace: Point[] = [[70,305],[125,290],[363,269],[435,250],[560,212],[699,166],[936,56]];

export type EventBackground = 'trees' | 'clear' | 'none';
export type EventPhoto = { url: string; width: number; height: number; fit: ReturnType<typeof calibrate>; center: Point };
const backgrounds = {
  trees: '/data/referencia-con-arboles.png',
  clear: '/data/referencia-sin-arboles.png',
};
const width = 1691, height = 930;
// Similarity from either aerial variant to the original annotated screenshot, fitted on shared rooftops.
const registration = { a:.749,b:.0425,tx:-130.4,ty:-89.6 };
function toVariant(u: number,v: number): Point {
  const { a,b,tx,ty } = registration;
  const norm = a*a+b*b;
  return [(a*(u-tx)-b*(v-ty))/norm,(b*(u-tx)+a*(v-ty))/norm];
}
export function eventReference(terrain: Terrain) {
  const ring = terrain.rings[0];
  if (terrain.provisional || ring.length !== 26 || distance(terrain.origin,origin) > .01 ||
      distance(ring[9],[339.33,56.89]) > .02 || distance(ring[21],[113.72,29.08]) > .02) return;
  const fit = calibrate(controls.map(([index,u,v]) => {
    const [x,y] = ring[index];
    return { u,v,x,y };
  }));
  const project = ([u,v]: Point): Point => [fit.a*u+fit.b*v+fit.tx,fit.b*u-fit.a*v+fit.ty];
  const backgroundFit = calibrate(controls.map(([index,u,v]) => {
    const [x,y] = ring[index];
    const [pixelX,pixelY] = toVariant(u,v);
    return { u:pixelX,v:pixelY,x,y };
  }));
  const background = (variant: EventBackground): EventPhoto | undefined => variant === 'none' ? undefined : {
    url:backgrounds[variant], width,height, fit:backgroundFit,
    center:[backgroundFit.a*width/2+backgroundFit.b*height/2+backgroundFit.tx,
      backgroundFit.b*width/2-backgroundFit.a*height/2+backgroundFit.ty],
  };
  return { fit, background, points:trace.map(project) };
}
export const lineLength = (points: Point[]) => points.slice(1).reduce((sum,p,i) => sum+distance(points[i],p),0);
export function lengthLabel(points: Point[], approximate: boolean) {
  const format = (n: number) => n.toLocaleString('es-CO',{ maximumFractionDigits:approximate ? 0 : 2 });
  const prefix = approximate ? '≈ ' : '';
  return prefix+format(lineLength(points))+' m por el trazado · '+prefix+format(distance(points[0],points.at(-1)!))+' m en recta';
}
