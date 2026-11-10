import Dexie, { type Table } from 'dexie';
import { attachStructureModels } from './catalog';
import { validateRing, validateTerrain } from './geo';
import { validateOrtho } from './ortho';
import { categories, zoneColors } from './types';
import type { ModelFile, Point, Project } from './types';

type Snapshot = { id: string; project: Project };
type Bundle = { id: string; files: ModelFile[] };
export class PlannerDB extends Dexie {
  snapshots!: Table<Snapshot,string>;
  models!: Table<Bundle,string>;
  constructor(name = 'vueltabajero-planner') {
    super(name);
    this.version(1).stores({ snapshots: 'id', models: 'id' });
  }
}
export const db = new PlannerDB();
export async function loadProject(database = db) {
  const snapshot = await database.snapshots.get('current');
  return snapshot && attachStructureModels(snapshot.project);
}
export async function saveProject(project: Project, database = db) {
  await database.snapshots.put({ id: 'current', project });
}
export function blobUrlData(blob: Blob): Promise<string> {
  return new Promise((resolve,reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
export async function exportProject(project: Project) {
  const ids = [...new Set(project.assets.flatMap(a => a.file ? [a.file] : []))];
  const models = await Promise.all(ids.map(async id => {
    const bundle = await db.models.get(id);
    if (!bundle) throw new Error('Falta el archivo del modelo ' + id);
    return { id, files: await Promise.all(bundle.files.map(async f => ({ name: f.name, data: await blobUrlData(f.data) }))) };
  }));
  return JSON.stringify({ ...project, models }, null, 2);
}
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const point = (p: unknown): p is Point => Array.isArray(p) && p.length === 2 && p.every(finite);
const str = (s: unknown): s is string => typeof s === 'string';
const ids = (list: { id: string }[]) => list.every(v => v && str(v.id) && v.id.length > 0) && new Set(list.map(v => v.id)).size === list.length;
function requireData(value: unknown): asserts value {
  if (!value) throw new Error('El JSON no corresponde a un proyecto válido de versión 1.');
}
export function validateProject(p: Project) {
  requireData(p?.version === 1 && str(p.name) && p.terrain && Array.isArray(p.scenarios) && ids(p.scenarios) &&
    p.scenarios.some(s => s.id === p.active) && Array.isArray(p.assets) && ids(p.assets));
  const t = p.terrain;
  requireData(str(t.name) && typeof t.provisional === 'boolean' && point(t.origin) && Array.isArray(t.rings) &&
    t.rings.every(r => Array.isArray(r) && r.every(point)) && Array.isArray(t.altitudes) &&
    (t.altitudes.length === 0 || (t.altitudes.length === t.rings.length &&
      t.altitudes.every((r,i) => Array.isArray(r) && r.length === t.rings[i].length && r.every(n => n === null || finite(n))))));
  validateTerrain(t.rings);
  for (const a of p.assets) {
    requireData(str(a.name) && categories.includes(a.category) && [a.w,a.d,a.h].every(v => finite(v) && v >= 0) &&
      [a.anchorX,a.anchorY,a.yaw].every(finite) && finite(a.unit) && a.unit > 0 && /^#[\da-f]{6}$/i.test(a.color) &&
      typeof a.provisional === 'boolean' && (a.file === undefined || str(a.file)) &&
      (a.builtin === undefined || (str(a.builtin) && /^\/models\/[\w-]+\.glb$/.test(a.builtin))) &&
      (a.thumbnail === undefined || /^data:image\/(png|jpeg|webp);base64,/.test(a.thumbnail)));
  }
  const assets = new Set(p.assets.map(a => a.id));
  for (const s of p.scenarios) {
    requireData(str(s.name) && Array.isArray(s.zones) && ids(s.zones) && Array.isArray(s.items) && ids(s.items));
    for (const z of s.zones) {
      requireData(str(z.name) && Object.hasOwn(zoneColors,z.kind) && Array.isArray(z.ring) && z.ring.every(point));
      validateRing(z.ring);
    }
    for (const i of s.items) requireData(str(i.name) && assets.has(i.assetId) && categories.includes(i.category) &&
      [i.x,i.y,i.z,i.rotation].every(finite) && [i.w,i.d,i.h].every(v => finite(v) && v >= 0) &&
      typeof i.locked === 'boolean' && typeof i.hidden === 'boolean' && str(i.status) && str(i.notes) &&
      (i.group === undefined || str(i.group)) && (i.felt === undefined || i.felt === 1 || i.felt === 2 || i.felt === 3) && (i.fencePanel === undefined || typeof i.fencePanel === 'boolean') && (i.cost === undefined || (finite(i.cost) && i.cost >= 0)));
  }
  if (p.lengthLine) requireData(!t.provisional && str(p.lengthLine.name) && Array.isArray(p.lengthLine.points) &&
    p.lengthLine.points.length >= 2 && p.lengthLine.points.every(point));
  if (p.ortho) {
    const o = p.ortho;
    requireData(/^data:image\/(png|jpeg|webp);base64,/.test(o.data) && finite(o.width) && o.width > 0 &&
      finite(o.height) && o.height > 0 && Array.isArray(o.points) && typeof o.visible === 'boolean');
    validateOrtho(o);
  }
}
export async function decodeProject(json: string) {
  const { models = [], ...project } = JSON.parse(json) as Project & { models?: { id: string; files: { name: string; data: string }[] }[] };
  validateProject(project);
  requireData(Array.isArray(models) && ids(models));
  const needed = new Set(project.assets.flatMap(a => a.file ? [a.file] : []));
  requireData(models.length === needed.size && models.every(m => needed.has(m.id)));
  const entries = await Promise.all(models.map(async m => {
    requireData(Array.isArray(m.files) && m.files.length > 0 && new Set(m.files.map(f => f.name)).size === m.files.length);
    const files = await Promise.all(m.files.map(async f => {
      requireData(str(f.name) && f.name.length > 0 && str(f.data) && /^data:[^,]*;base64,/.test(f.data));
      return { name: f.name, data: await (await fetch(f.data)).blob() };
    }));
    return { id:m.id,files };
  }));
  return { project, entries };
}
export async function importProject(json: string) {
  const { project, entries } = await decodeProject(json);
  const remapped = new Map(entries.map(m => [m.id,crypto.randomUUID()]));
  project.assets = project.assets.map(a => a.file ? { ...a, file: remapped.get(a.file)! } : a);
  const upgraded = attachStructureModels(project);
  await db.transaction('rw', db.models, db.snapshots, async () => {
    await db.models.bulkPut(entries.map(({ id,files }) => ({ id:remapped.get(id)!,files })));
    await saveProject(upgraded);
  });
  return upgraded;
}

