import type { Asset, Category, Project } from './types';

const colors: Record<Category, string> = {
  Escenarios:'#a897ff', Comida:'#ffc57a', Bares:'#b39df5', Baños:'#80aefe', Carpas:'#7adcb5', Artistas:'#fc97c8',
  'Plantas eléctricas':'#ead36f', Sillas:'#a0bed0', Mesas:'#efad89', Vallas:'#f38985', Accesos:'#93e0c9', Seguridad:'#9ab5fc', Vehículos:'#7ec3df',
};
function asset(id: string, name: string, category: Category, w: number, d: number, h: number, file?: string): Asset {
  return { id, name, category, w, d, h, yaw: 0, unit: 1, anchorX: 0, anchorY: 0, color: colors[category],
    provisional: !file || !w || !h, builtin: file && '/models/' + file + '.glb' };
}
const stage = asset('escenario','Escenario Vueltabajero','Escenarios',12,10,6.8,'obj_escenario');
const tent = asset('carpa-general','Carpa blanca','Carpas',3,3,2.5,'obj_carpa');
const fence = asset('valla','Valla modular','Vallas',2.772,1.032,1.9165,'valla_modulo');
const car = asset('auto-compacto','Auto compacto','Vehículos',1.8,4.2,1.45,'obj_auto');
const legacyFenceModel = '/models/valla_modular.glb';
const legacyFenceSize = ({ w,d,h }: Pick<Asset,'w'|'d'|'h'>) => w === 2 && d === .6 && h === 0;
const structureDefaults = new Map([stage,tent,fence].map(model => [model.id,model]));

export const catalog = [
  asset('gustico','El Gustico','Comida',4,4,0,'obj_gustico'),
  asset('burger','Distrit Burger','Comida',4,4,0,'obj_burger'),
  asset('bar','Venta Vueltabajero','Bares',3,2,0,'obj_bar_vueltabajero'),
  asset('carpa','Carpa de artistas','Artistas',3,3,0,'obj_carpa_artistas'),
  asset('planta','Planta eléctrica','Plantas eléctricas',2,2,0,'obj_planta'),
  fence,
  asset('mesa','Mesa','Mesas',0.67,0.54,0.42,'obj_mesa'),
  asset('silla','Silla','Sillas',0,0,0,'obj_silla'),
  asset('bano','Baño','Baños',0,0,0,'obj_bano'),
  stage,
  tent,
  asset('acceso','Punto de acceso','Accesos',0,0,0),
  asset('seguridad','Barricada','Seguridad',0,0,0,'obj_barricada'),
  car,
];
export function attachStructureModels(project: Project): Project {
  const upgraded = new Map<string,Asset>();
  const assets = project.assets.map(current => {
    const model = structureDefaults.get(current.id);
    const legacyFence = current.id === fence.id && current.builtin === legacyFenceModel;
    if (!model || current.file || (current.builtin && !legacyFence)) return current;
    if (legacyFence) {
      const next = legacyFenceSize(current) ? { ...current,w:fence.w,d:fence.d,h:fence.h,provisional:false,builtin:fence.builtin }
        : { ...current,builtin:fence.builtin };
      upgraded.set(current.id,next);
      return next;
    }
    const next = { ...current, builtin:model.builtin, w:current.w || model.w, d:current.d || model.d,
      h:current.h || model.h, provisional:current.w || current.d || current.h ? current.provisional : false };
    upgraded.set(current.id,next);
    return next;
  });
  const needsCar = !assets.some(asset => asset.id === car.id);
  if (needsCar) assets.push(car);
  if (!upgraded.size) return needsCar ? { ...project,assets } : project;
  return { ...project, assets, scenarios:project.scenarios.map(scenario => ({
    ...scenario, items:scenario.items.map(item => {
      const model = upgraded.get(item.assetId);
      if (!model) return item;
      if (item.assetId === fence.id) return legacyFenceSize(item) ? { ...item,w:fence.w,d:fence.d,h:fence.h } : item;
      return { ...item,w:item.w || model.w,d:item.d || model.d,h:item.h || model.h };
    }),
  })) };
}

export function newProject(): Project {
  return {
    version: 1, name: 'Vueltabajero', active: 'a', assets: catalog,
    terrain: { name: 'Terreno de práctica', provisional: true, origin: [0,0], altitudes: [],
      rings: [[[0,0],[86,0],[96,21],[90,43],[65,51],[17,46],[0,29]]] },
    scenarios: ['A','B','C'].map(name => ({ id: name.toLowerCase(), name, items: [], zones: [] })),
  };
}

