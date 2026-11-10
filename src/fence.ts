import type { Asset, Item, Point } from './types';

const moduleWidth = 2.772;
const basePitch = 2.29;
export function feltPanel(item: Pick<Item,'w'|'d'|'h'>) {
  const width = (item.w || moduleWidth)*2.2/moduleWidth;
  const heightScale = (item.h || 1.9165)/1.9165;
  return { width,height:1.75*heightScale,y:1.025*heightScale,offset:.022*(item.d || 1.032)/1.032 };
}
export function feltArea(item: Item) {
  const { width,height } = feltPanel(item);
  return width*height*(item.felt === 3 ? 2 : item.felt ? 1 : 0);
}
export const isModularFence = (asset: Asset) => asset.builtin === '/models/valla_modulo.glb' && !asset.file;

export function fenceLayout(points: Point[]) {
  const panels: Pick<Item,'x'|'y'|'w'|'rotation'>[] = [];
  for (let i = 1; i < points.length; i++) {
    const [x,y] = points[i-1];
    const [endX,endY] = points[i];
    const dx = endX-x, dy = endY-y;
    const length = Math.hypot(dx,dy);
    if (length === 0) continue;
    if (length < .5) throw new Error('Cada tramo de valla debe medir al menos 0,50 m.');
    const count = Math.max(1,Math.round(length/basePitch));
    if (panels.length+count > 500) throw new Error('Divide el recorrido en líneas de hasta 500 módulos.');
    const rotation = (Math.atan2(dy,dx)*180/Math.PI+360)%360;
    const w = moduleWidth*length/count/basePitch;
    for (let j = 0; j < count; j++) {
      const t = (j+.5)/count;
      panels.push({ x:x+dx*t,y:y+dy*t,w,rotation });
    }
  }
  if (!panels.length) throw new Error('Marca al menos dos puntos distintos para trazar la valla.');
  return panels;
}

export function fenceJoin(left: Item, right: Item) {
  if (!left.fencePanel || !right.fencePanel || !left.group || left.group !== right.group || left.z !== right.z) return false;
  const end = (item: Item, direction: number): Point => {
    const angle = item.rotation*Math.PI/180;
    const offset = direction*item.w*basePitch/moduleWidth/2;
    return [item.x+Math.cos(angle)*offset,item.y+Math.sin(angle)*offset];
  };
  const a = end(left,1), b = end(right,-1);
  return Math.hypot(a[0]-b[0],a[1]-b[1]) < .001;
}
