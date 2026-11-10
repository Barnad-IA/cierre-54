import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { catalog, newProject } from '../src/catalog';
import { activeScenario, useEditor } from '../src/editor';
import { loadProject, PlannerDB, saveProject, validateProject } from '../src/storage';

it('persiste escenarios y binarios y los recupera desde una nueva conexión', async () => {
  const db = new PlannerDB('test-'+crypto.randomUUID());
  const editor = useEditor.getState();
  editor.replace(newProject());
  editor.place(catalog[3],[3.26,5.4]);
  const item = activeScenario(useEditor.getState().project).items[0];
  editor.update(item.id,{ rotation:45 });
  editor.duplicate();
  editor.undo();
  expect(activeScenario(useEditor.getState().project).items).toHaveLength(1);
  editor.redo();
  const project = useEditor.getState().project;
  const model = new Blob([new Uint8Array([103,108,84,70])],{ type:'model/gltf-binary' });
  project.assets = project.assets.map(a => a.id === 'carpa' ? { ...a,file:'custom' } : a);
  await db.models.put({ id:'custom',files:[{ name:'carpa.glb',data:model }] });
  await saveProject(project,db);
  db.close();
  const reopened = new PlannerDB(db.name);
  try {
    const saved = (await loadProject(reopened))!;
    validateProject(saved);
    expect(saved.scenarios).toHaveLength(3);
    expect(activeScenario(saved).items[0]).toMatchObject({ x:3.5,y:5.5,rotation:45,assetId:'carpa' });
    expect(activeScenario(saved).items).toHaveLength(2);
    const id = saved.assets.find(a => a.id === 'carpa')!.file!;
    const bytes = await (await reopened.models.get(id))!.files[0].data.arrayBuffer();
    expect([...new Uint8Array(bytes)]).toEqual([103,108,84,70]);
  } finally { await reopened.delete(); }
});


it('reemplaza las primitivas de estructura al abrir un proyecto guardado', async () => {
  const database = new PlannerDB('test-'+crypto.randomUUID());
  const editor = useEditor.getState();
  const project = newProject();
  project.assets = project.assets.map(a => a.id === 'escenario' || a.id === 'carpa-general'
    ? { ...a,builtin:undefined,w:0,d:0,h:0,provisional:true }
    : a);
  editor.replace(project);
  const [stage,tent] = ['escenario','carpa-general'].map(id => project.assets.find(a => a.id === id)!);
  editor.place(stage,[12,23]);
  editor.place(tent,[30,40]);
  const scenario = activeScenario(useEditor.getState().project);
  editor.update(scenario.items[1].id,{ w:4,rotation:30 });
  try {
    await saveProject(useEditor.getState().project,database);
    const saved = (await loadProject(database))!;
    expect(saved.assets.find(a => a.id === stage.id)?.builtin).toBe('/models/obj_escenario.glb');
    expect(saved.assets.find(a => a.id === tent.id)?.builtin).toBe('/models/obj_carpa.glb');
    expect(activeScenario(saved).items[0]).toMatchObject({ x:12,y:23,w:12,d:10,h:6.8 });
    expect(activeScenario(saved).items[1]).toMatchObject({ x:30,y:40,w:4,d:3,h:2.5,rotation:30 });
  } finally { await database.delete(); }
});

it('cambia la valla antigua al módulo centrado y respeta dimensiones personalizadas', async () => {
  const database = new PlannerDB('test-'+crypto.randomUUID());
  const editor = useEditor.getState();
  const project = newProject();
  const legacy = { ...project.assets.find(a => a.id === 'valla')!,
    w:2,d:.6,h:0,builtin:'/models/valla_modular.glb',provisional:true };
  project.assets = project.assets.map(a => a.id === legacy.id ? legacy : a);
  editor.replace(project);
  editor.place(legacy,[5,8]);
  editor.place(legacy,[10,14]);
  const items = activeScenario(useEditor.getState().project).items;
  editor.update(items[1].id,{ w:3,rotation:25 });
  try {
    await saveProject(useEditor.getState().project,database);
    const saved = (await loadProject(database))!;
    expect(saved.assets.find(a => a.id === legacy.id)?.builtin).toBe('/models/valla_modulo.glb');
    expect(activeScenario(saved).items[0]).toMatchObject({ x:5,y:8,w:2.772,d:1.032,h:1.9165 });
    expect(activeScenario(saved).items[1]).toMatchObject({ x:10,y:14,w:3,d:.6,h:0,rotation:25 });
  } finally { await database.delete(); }
});

it('coloca una línea de vallas con esquinas como una sola edición', () => {
  const editor = useEditor.getState();
  editor.replace(newProject());
  expect(editor.placeFence([[10,15],[14.58,15],[14.58,17.29]])).toBe(3);
  const items = activeScenario(useEditor.getState().project).items;
  expect(items.map(i => i.rotation)).toEqual([0,0,90]);
  expect(items[0].x).toBeCloseTo(11.145);
  expect(items[2].y).toBeCloseTo(16.145);
  expect(items.every(i => i.fencePanel && i.group === items[0].group)).toBe(true);
  editor.undo();
  expect(activeScenario(useEditor.getState().project).items).toHaveLength(0);
  editor.redo();
  expect(activeScenario(useEditor.getState().project).items).toHaveLength(3);
});

it('coloca veinte sillas alineadas con separación entre sus bordes', () => {
  const editor = useEditor.getState();
  editor.replace(newProject());
  expect(editor.placeChairs([[10,15],[10,16]],20,.15)).toBe(20);
  const items = activeScenario(useEditor.getState().project).items;
  expect(items.every(i => i.x === 10 && i.rotation === 90 && i.group === items[0].group)).toBe(true);
  expect(items[19].y).toBeCloseTo(15+19*(.525+.15));
  editor.undo();
  expect(activeScenario(useEditor.getState().project).items).toHaveLength(0);
});

it('exporta solo el escenario activo y excluye datos privados de la copia pública', async () => {
  const { decodePublicEvent,exportPublicEvent } = await import('../src/publicEvent');
  const editor = useEditor.getState();
  editor.replace(newProject());
  const car = editor.project.assets.find(a => a.id === 'auto-compacto') ?? newProject().assets.find(a => a.id === 'auto-compacto')!;
  editor.place(car,[12,15]);
  editor.place(car,[16,18]);
  const [visible,hidden] = activeScenario(useEditor.getState().project).items;
  editor.update(visible.id,{ notes:'Nota privada',cost:12345 });
  editor.update(hidden.id,{ hidden:true,name:'Objeto privado' });
  const source = useEditor.getState().project;
  source.scenarios[1] = { ...source.scenarios[1],name:'Alternativa privada' };
  const json = await exportPublicEvent(source,'clear',true);
  const decoded = await decodePublicEvent(json);
  expect(decoded.project.scenarios).toHaveLength(1);
  expect(decoded.project.assets.map(a => a.id)).toEqual([car.id]);
  expect(activeScenario(decoded.project).items).toMatchObject([{ id:visible.id,locked:true,notes:'' }]);
  expect(json).not.toMatch(/Nota privada|12345|Objeto privado|Alternativa privada/);
  expect(activeScenario(source).items).toHaveLength(2);
});
