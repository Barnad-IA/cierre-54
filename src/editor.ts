import { create } from 'zustand';
import { newProject } from './catalog';
import { fenceLayout, isModularFence } from './fence';
import { snapTo } from './geo';
import { uid } from './types';
import type { Asset, Item, Point, Project, Scenario, Tool } from './types';

export const activeScenario = (p: Project) => p.scenarios.find(s => s.id === p.active)!;
export const changeScenario = (p: Project, edit: (s: Scenario) => Scenario): Project => ({
  ...p, scenarios: p.scenarios.map(s => s.id === p.active ? edit(s) : s),
});
function makeItem(asset: Asset, x: number, y: number): Item {
  return { id:uid(), assetId:asset.id, name:asset.name, category:asset.category, w:asset.w, d:asset.d, h:asset.h,
    x,y,z:0,rotation:0,locked:false,hidden:false,status:'Pendiente',notes:'' };
}
export type Editor = {
  project: Project; past: Project[]; future: Project[]; selected: string[]; snap: number; tool: Tool;
  edit: (fn: (p: Project) => Project) => void; replace: (p: Project) => void; undo: () => void; redo: () => void;
  select: (id?: string, extend?: boolean, single?: boolean) => void; place: (asset: Asset, point: Point) => void;
  placeFence: (points: Point[]) => number;
  placeChairs: (points: Point[], count: number, gap: number) => number;
  update: (id: string, values: Partial<Item>) => void; move: (positions: Record<string, Point>) => void;
  duplicate: () => void; remove: () => void; group: () => void;
};
export const useEditor = create<Editor>((set, get) => ({
  project: newProject(), past: [], future: [], selected: [], snap: 0.5, tool: 'select',
  edit: fn => set(s => {
    const next = fn(s.project);
    return next === s.project ? s : { project: next, past: [...s.past.slice(-49), s.project], future: [] };
  }),
  replace: project => set({ project, past: [], future: [], selected: [], tool: 'select' }),
  undo: () => set(s => s.past.length ? { project: s.past.at(-1)!, past: s.past.slice(0,-1), future: [s.project, ...s.future], selected: [] } : s),
  redo: () => set(s => s.future.length ? { project: s.future[0], past: [...s.past, s.project], future: s.future.slice(1), selected: [] } : s),
  select: (id, extend, single) => set(s => {
    if (!id) return { selected: [] };
    const items = activeScenario(s.project).items;
    const target = items.find(i => i.id === id);
    if (!target) return s;
    const ids = target.group && !single ? items.filter(i => i.group === target.group && !i.hidden).map(i => i.id) : [id];
    if (!extend) return { selected: ids };
    const selected = ids.every(i => s.selected.includes(i)) ? s.selected.filter(i => !ids.includes(i)) : [...new Set([...s.selected, ...ids])];
    return { selected };
  }),
  place: (asset, [x,y]) => {
    const { snap, edit } = get();
    const item = makeItem(asset,snapTo(x,snap),snapTo(y,snap));
    edit(p => changeScenario(p,s => ({ ...s, items: [...s.items,item] })));
    set({ selected: [item.id], tool: 'select' });
  },
  placeFence: points => {
    const { project,edit } = get();
    const asset = project.assets.find(isModularFence);
    if (!asset) throw new Error('El catálogo debe incluir el modelo de valla modular.');
    const group = uid();
    const items = fenceLayout(points).map(panel => ({
      ...makeItem(asset,panel.x,panel.y), ...panel, group, fencePanel:true,
    }));
    edit(p => changeScenario(p,s => ({ ...s,items:[...s.items,...items] })));
    set({ selected:items.map(i => i.id) });
    return items.length;
  },
  placeChairs: (points,count,gap) => {
    const { project,edit } = get();
    const asset = project.assets.find(a => a.id === 'silla');
    if (!asset) throw new Error('El catálogo debe incluir la silla.');
    if (!Number.isInteger(count) || count < 1 || count > 500 || !Number.isFinite(gap) || gap < 0 || gap > 10) {
      throw new Error('Indica entre 1 y 500 sillas y una separación de 0 a 10 m.');
    }
    const [start,end] = points;
    if (!start || !end) throw new Error('Marca el inicio y la dirección de la fila.');
    const dx = end[0]-start[0], dy = end[1]-start[1];
    const length = Math.hypot(dx,dy);
    if (length === 0) throw new Error('Marca dos puntos distintos para orientar la fila.');
    const builtin = asset.builtin === '/models/obj_silla.glb' && !asset.file;
    const w = asset.w || (builtin ? .525 : 0);
    const d = asset.d || (builtin ? .565 : 0);
    const h = asset.h || (builtin ? .87 : 0);
    if (!w || !d) throw new Error('Indica el ancho y fondo de la silla en el catálogo.');
    const group = uid();
    const rotation = (Math.atan2(dy,dx)*180/Math.PI+360)%360;
    const items = Array.from({ length:count },(_,i) => {
      const step = i*(w+gap)/length;
      return { ...makeItem(asset,start[0]+dx*step,start[1]+dy*step),w,d,h,rotation,group };
    });
    edit(p => changeScenario(p,s => ({ ...s,items:[...s.items,...items] })));
    set({ selected:items.map(i => i.id) });
    return items.length;
  },
  update: (id, values) => get().edit(p => changeScenario(p, s => ({ ...s, items: s.items.map(i => i.id === id ? { ...i, ...values } : i) }))),
  move: positions => get().edit(p => changeScenario(p,s => ({ ...s, items: s.items.map(i => {
    const pos = positions[i.id];
    return pos && !i.locked ? { ...i, x: pos[0], y: pos[1] } : i;
  }) }))),
  duplicate: () => {
    const { project, selected, edit, snap } = get();
    const groups = new Map<string, string>();
    const delta = snap || 0.5;
    const copies = activeScenario(project).items.filter(i => selected.includes(i.id)).map(i => {
      if (i.group && !groups.has(i.group)) groups.set(i.group, uid());
      return { ...i, id: uid(), x: i.x + delta, y: i.y + delta, locked: false, group: i.group && groups.get(i.group) };
    });
    if (!copies.length) return;
    edit(p => changeScenario(p,s => ({ ...s, items: [...s.items, ...copies] })));
    set({ selected: copies.map(i => i.id) });
  },
  remove: () => {
    const { selected, edit } = get();
    edit(p => changeScenario(p,s => ({ ...s, items: s.items.filter(i => !selected.includes(i.id) || i.locked) })));
    set({ selected: [] });
  },
  group: () => {
    const { selected, project, edit } = get();
    const items = activeScenario(project).items.filter(i => selected.includes(i.id));
    if (!items.length) return;
    const existing = items[0].group;
    const group = existing && items.every(i => i.group === existing) ? undefined : uid();
    edit(p => changeScenario(p,s => ({ ...s, items: s.items.map(i => selected.includes(i.id) ? { ...i, group } : i) })));
  },
}));

