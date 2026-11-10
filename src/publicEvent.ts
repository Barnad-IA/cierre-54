import { activeScenario } from './editor';
import { decodeProject, exportProject } from './storage';
import type { EventBackground } from './eventReference';
import type { Asset, Project } from './types';

const format = 'vueltabajero-public-v1';
export const eventSlug = (value: string) => value.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu,'')
  .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80).replace(/-+$/,'');
export const validEventSlug = (value: string) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 80;

export async function exportPublicEvent(project: Project, background: EventBackground, showTerrain: boolean) {
  const active = activeScenario(project);
  const items = active.items.filter(i => !i.hidden).map(i => ({
    id:i.id, assetId:i.assetId, name:i.name, category:i.category, w:i.w,d:i.d,h:i.h,x:i.x,y:i.y,z:i.z,
    rotation:i.rotation,group:i.group,felt:i.felt,fencePanel:i.fencePanel,locked:true,hidden:false,notes:'',status:'',
  }));
  const used = new Set(items.map(i => i.assetId));
  const assets = project.assets.filter(a => used.has(a.id)).map(({ id,name,category,w,d,h,yaw,unit,anchorX,anchorY,color,provisional,file,builtin }): Asset =>
    ({ id,name,category,w,d,h,yaw,unit,anchorX,anchorY,color,provisional,file,builtin }));
  const snapshot: Project = { version:1,name:project.name,active:active.id,terrain:project.terrain,assets,
    scenarios:[{ id:active.id,name:active.name,items,zones:[] }], lengthLine:showTerrain ? project.lengthLine : undefined,
    ortho:project.ortho?.visible ? project.ortho : undefined };
  return JSON.stringify({ format,background,showTerrain,project:JSON.parse(await exportProject(snapshot)) });
}

export async function decodePublicEvent(source: string) {
  const value = JSON.parse(source);
  if (value?.format !== format || !['trees','clear','none'].includes(value.background) || typeof value.showTerrain !== 'boolean') {
    throw new Error('El archivo no es una vista pública de Vueltabajero.');
  }
  const { project,entries } = await decodeProject(JSON.stringify(value.project));
  return { project,background:value.background as EventBackground,showTerrain:value.showTerrain as boolean,
    files:new Map(entries.map(entry => [entry.id,entry.files])) };
}

export type PublicEvent = Awaited<ReturnType<typeof decodePublicEvent>>;
