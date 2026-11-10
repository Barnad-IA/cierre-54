import { AmbientLight, Box3, DirectionalLight, Group, LoadingManager, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { db } from './storage';
import type { Asset, Item, ModelFile } from './types';

export async function parseModel(files: ModelFile[]) {
  const root = files.find(f => /\.(glb|gltf)$/i.test(f.name));
  if (!root || files.filter(f => /\.(glb|gltf)$/i.test(f.name)).length !== 1) throw new Error('Selecciona un GLB o glTF y sus recursos asociados.');
  if (new Set(files.map(f => f.name)).size !== files.length) throw new Error('Hay archivos con el mismo nombre.');
  const urls = new Map(files.map(f => [f.name, URL.createObjectURL(f.data)]));
  const manager = new LoadingManager();
  manager.setURLModifier(url => {
    if (/^(data|blob):/i.test(url)) return url;
    if (/^[a-z][a-z\d+.-]*:|^\/\//i.test(url)) throw new Error('El modelo hace referencia a recursos externos.');
    const name = decodeURIComponent(url.split(/[?#]/)[0]).replaceAll('\\','/').split('/').at(-1)!;
    const resource = urls.get(name);
    if (!resource) throw new Error('Falta el recurso ' + name);
    return resource;
  });
  try {
    const data = /\.gltf$/i.test(root.name) ? await root.data.text() : await root.data.arrayBuffer();
    const gltf = await new GLTFLoader(manager).parseAsync(data,'');
    const size = new Box3().setFromObject(gltf.scene);
    if (size.isEmpty() || !Number.isFinite(size.getSize(new Vector3()).length())) throw new Error('El archivo no contiene geometría visible válida.');
    return gltf.scene;
  } finally {
    urls.forEach(url => URL.revokeObjectURL(url));
  }
}
const cache = new Map<string, Promise<Group>>();
export function getModel(asset: Asset) {
  const key = asset.file || asset.builtin;
  if (!key) return;
  if (!cache.has(key)) {
    const promise = asset.file ? db.models.get(asset.file).then(bundle => {
      if (!bundle) throw new Error('El archivo original no está disponible.');
      return parseModel(bundle.files);
    }) : fetch(asset.builtin!).then(async response => {
      if (!response.ok) throw new Error('No se pudo cargar el GLB de Blender.');
      return parseModel([{ name: 'model.glb', data: await response.blob() }]);
    });
    cache.set(key,promise);
    void promise.catch(() => cache.delete(key));
  }
  return cache.get(key);
}
export function rememberModel(id: string, object: Group) {
  cache.set(id,Promise.resolve(object));
}
export function modelDimensions(model: Group, yaw: number, unit: number) {
  const group = new Group();
  group.add(clone(model));
  group.rotation.y = yaw*Math.PI/180;
  group.scale.setScalar(unit);
  group.updateMatrixWorld(true);
  return new Box3().setFromObject(group).getSize(new Vector3());
}
export function instance(model: Group, a: Asset, i: Pick<Item,'w'|'d'|'h'>) {
  const oriented = new Group();
  oriented.add(clone(model));
  oriented.rotation.y = a.yaw*Math.PI/180;
  oriented.updateMatrixWorld(true);
  const box = new Box3().setFromObject(oriented);
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  const x = i.w > 0 && size.x > 0 ? i.w/size.x : a.unit;
  const y = i.h > 0 && size.y > 0 ? i.h/size.y : a.unit;
  const z = i.d > 0 && size.z > 0 ? i.d/size.z : a.unit;
  const output = new Group();
  output.add(oriented);
  output.scale.set(x,y,z);
  output.position.set(-center.x*x-a.anchorX,-box.min.y*y,-center.z*z+a.anchorY);
  return output;
}
export function thumbnail(model: Group): string | undefined {
  let renderer: WebGLRenderer | undefined;
  try {
    const scene = new Scene();
    const object = clone(model);
    const box = new Box3().setFromObject(object);
    const center = box.getCenter(new Vector3());
    const radius = box.getSize(new Vector3()).length() || 1;
    object.position.sub(center);
    scene.add(object,new AmbientLight(0xffffff,2.1));
    const sun = new DirectionalLight(0xffffff,2.5);
    sun.position.set(3,6,5);
    scene.add(sun);
    const camera = new PerspectiveCamera(35,1,radius/100,radius*10);
    camera.position.set(1,.85,1.3).normalize().multiplyScalar(radius*1.75);
    camera.lookAt(0,0,0);
    renderer = new WebGLRenderer({ alpha:true, antialias:true, preserveDrawingBuffer:true });
    renderer.setSize(104,104);
    renderer.render(scene,camera);
    return renderer.domElement.toDataURL('image/png');
  } catch {
    return undefined;
  } finally {
    renderer?.dispose();
    renderer?.forceContextLoss();
  }
}

