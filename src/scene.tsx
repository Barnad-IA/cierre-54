import { Component, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber';
import { Line, OrbitControls, PointerLockControls } from '@react-three/drei';
import { DoubleSide, Euler, Path, PlaneGeometry, Shape, SRGBColorSpace, TextureLoader, Vector3 } from 'three';
import type { Group } from 'three';
import type { EventBackground, EventPhoto } from './eventReference';
import { eventReference } from './eventReference';
import { feltPanel, fenceJoin, isModularFence } from './fence';
import { bounds, footprint } from './geo';
import { activeScenario, useEditor } from './editor';
import { getModel, instance } from './models';
import { zoneColors } from './types';
import type { Asset, Item, Point, Project, Ring } from './types';

export const worldPosition = (x: number, y: number, z = 0): [number,number,number] => [x,z,-y];
const points = (ring: Ring, height: number) => [...ring,ring[0]].map(([x,y]) => worldPosition(x,y,height));
function polygonShape(rings: Ring[]) {
  const [outer,...holes] = rings;
  const shape = new Shape();
  function trace(p: Path, ring: Ring) {
    p.moveTo(...ring[0]);
    ring.slice(1).forEach(v => p.lineTo(...v));
    p.closePath();
  }
  trace(shape,outer);
  shape.holes = holes.map(r => { const hole = new Path(); trace(hole,r); return hole; });
  return shape;
}
function Ground({ rings, color, height = 0, opacity = 1 }: { rings: Ring[]; color: string; height?: number; opacity?: number }) {
  const shape = useMemo(() => polygonShape(rings),[rings]);
  return <mesh rotation={[-Math.PI/2,0,0]} position-y={height} renderOrder={height ? 2 : 0}>
    <shapeGeometry args={[shape]}/>
    <meshStandardMaterial color={color} transparent={opacity < 1} opacity={opacity} depthWrite={opacity === 1}/>
  </mesh>;
}
function ReferenceSurface({ reference }: { reference: EventPhoto }) {
  const texture = useLoader(TextureLoader,reference.url);
  const { fit,width,height } = reference;
  const geometry = useMemo(() => new PlaneGeometry(width*fit.scale,height*fit.scale).rotateX(-Math.PI/2),[width,height,fit.scale]);
  useEffect(() => () => geometry.dispose(),[geometry]);
  useEffect(() => { texture.colorSpace = SRGBColorSpace; texture.needsUpdate = true; },[texture]);
  const [x,y] = reference.center;
  return <mesh geometry={geometry} position={worldPosition(x,y,-.035)} rotation-y={Math.atan2(fit.b,fit.a)}>
    <meshBasicMaterial map={texture} color="#c2c9cf"/>
  </mesh>;
}
function RenderItem({ item, asset, sharedBase, selected, alert, onSelect, onError, loadModel = getModel }: { item: Item; asset: Asset; sharedBase: boolean; selected: boolean; alert: boolean;
  onSelect?: (extend: boolean) => void; onError: (name: string) => void; loadModel?: typeof getModel }) {
  const key = asset.file || asset.builtin;
  const [loaded,setLoaded] = useState<{ key: string; model: Group }>();
  const { name } = asset;
  useEffect(() => {
    let active = true;
    if (!key) return;
    void loadModel(asset)?.then(model => { if (active) setLoaded({ key,model }); }).catch(() => { if (active) onError(name); });
    return () => { active = false; };
  },[key,asset,onError,name,loadModel]);
  const raw = loaded?.key === key ? loaded?.model : undefined;
  const model = useMemo(() => {
    if (!raw) return;
    const object = instance(raw,asset,item);
    if (sharedBase && isModularFence(asset)) {
      const base = object.getObjectByName('Base_01');
      if (base) base.visible = false;
    }
    return object;
  },[raw,asset,item,sharedBase]);
  const w = item.w || 1, d = item.d || 1, h = item.h || .6;
  const felt = item.felt && isModularFence(asset) ? feltPanel(item) : undefined;
  return <group>
    <group position={worldPosition(item.x,item.y,item.z)} rotation-y={item.rotation*Math.PI/180}
      onPointerDown={e => { if (onSelect && e.button === 0) { e.stopPropagation(); onSelect(e.shiftKey); } }}>
      {model ? <primitive object={model} dispose={null}/> : <mesh position-y={h/2}>
        <boxGeometry args={[w,h,d]}/><meshStandardMaterial color={asset.color} transparent={!item.w || !item.d} opacity={!item.w || !item.d ? .55 : 1}/>
      </mesh>}
      {felt && ([1,2] as const).filter(side => (item.felt ?? 0) & side).map(side =>
        <mesh key={side} position={[-asset.anchorX,felt.y,(side === 1 ? felt.offset : -felt.offset)+asset.anchorY]}
          rotation-y={side === 1 ? 0 : Math.PI}>
          <planeGeometry args={[felt.width,felt.height]}/>
          <meshStandardMaterial color="#0e0e10" roughness={1} side={DoubleSide}/>
        </mesh>)}
    </group>
    {onSelect && <Line points={points(footprint({ ...item,w,d }),.075)} color={selected ? '#ffffff' : alert ? '#ff8d7e' : asset.color} lineWidth={selected ? 2.5 : 1.3}/>}
  </group>;
}
function Walk({ center, controls }: { center: Point; controls?: Set<string> }) {
  const { camera, gl } = useThree();
  const pressed = useMemo(() => new Set<string>(),[]);
  useEffect(() => {
    camera.position.set(center[0],1.65,-center[1]);
    camera.lookAt(center[0],1.65,-center[1]-1);
    const down = (e: KeyboardEvent) => {
      if (controls && /^(Key[WASD]|Arrow(Up|Down|Left|Right))$/.test(e.code) &&
          !e.ctrlKey && !e.metaKey && !e.altKey && !/INPUT|SELECT|TEXTAREA/.test((e.target as HTMLElement)?.tagName)) {
        e.preventDefault();
        pressed.add(e.code);
      } else if (document.pointerLockElement) pressed.add(e.code);
    };
    const up = (e: KeyboardEvent) => pressed.delete(e.code);
    const release = () => { if (!document.pointerLockElement) pressed.clear(); };
    addEventListener('keydown',down);
    addEventListener('keyup',up);
    document.addEventListener('pointerlockchange',release);
    addEventListener('blur',release);
    return () => {
      removeEventListener('keydown',down); removeEventListener('keyup',up); removeEventListener('blur',release);
      document.removeEventListener('pointerlockchange',release);
    };
  },[camera,center,pressed,controls]);
  useEffect(() => {
    if (!controls) return;
    const canvas = gl.domElement;
    let pointer: { id: number; x: number; y: number } | undefined;
    const angles = new Euler(0,0,0,'YXZ');
    const down = (e: PointerEvent) => {
      if (pointer !== undefined || e.button !== 0) return;
      pointer = { id:e.pointerId,x:e.clientX,y:e.clientY };
      canvas.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointer?.id) return;
      angles.setFromQuaternion(camera.quaternion);
      angles.y -= (e.clientX-pointer.x)*.004;
      angles.x = Math.max(-1.45,Math.min(1.45,angles.x-(e.clientY-pointer.y)*.004));
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      camera.quaternion.setFromEuler(angles);
    };
    const end = (e: PointerEvent) => { if (e.pointerId === pointer?.id) pointer = undefined; };
    canvas.addEventListener('pointerdown',down);
    canvas.addEventListener('pointermove',move);
    canvas.addEventListener('lostpointercapture',end);
    return () => {
      canvas.removeEventListener('pointerdown',down);
      canvas.removeEventListener('pointermove',move);
      canvas.removeEventListener('lostpointercapture',end);
    };
  },[camera,controls,gl]);
  const forward = useMemo(() => new Vector3(),[]);
  useFrame((_,delta) => {
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    const amount = Math.min(delta,.05)*3;
    const moving = (key: string,arrow: string) => Number(pressed.has(key) || pressed.has(arrow) || !!controls?.has(key));
    const f = moving('KeyW','ArrowUp')-moving('KeyS','ArrowDown');
    const r = moving('KeyD','ArrowRight')-moving('KeyA','ArrowLeft');
    camera.position.x += amount*(f*forward.x-r*forward.z);
    camera.position.z += amount*(f*forward.z+r*forward.x);
  });
  return controls ? null : <PointerLockControls selector="#walk-start"/>;
}
class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed:false };
  static getDerivedStateFromError() { return { failed:true }; }
  render() {
    return this.state.failed ? <div className="scene-fallback">El visor 3D necesita WebGL. El plano 2D sigue disponible.</div> : this.props.children;
  }
}
export default function Scene3D({ showTerrain, background, walk, alerts, onError, publicProject, loadModel }: {
  showTerrain: boolean; background: EventBackground; walk: boolean; alerts: Record<string,string[]>;
  onError: (name: string) => void; publicProject?: Project; loadModel?: typeof getModel;
}) {
  const editor = useEditor();
  const project = publicProject ?? editor.project;
  const selected = publicProject ? [] : editor.selected;
  const controls = useRef(new Set<string>());
  const { terrain } = project;
  const reference = useMemo(() => eventReference(terrain),[terrain]);
  const photo = reference?.background(background);
  const length = showTerrain ? project.lengthLine?.points || reference?.points : undefined;
  const scenario = activeScenario(project);
  const [l,b,r,t] = bounds(terrain.rings[0]);
  const center = useMemo<Point>(() => [(l+r)/2,(b+t)/2],[l,b,r,t]);
  const size = Math.max(r-l,t-b,5);
  const lookup = new Map(project.assets.map(a => [a.id,a]));
  const visibleItems = scenario.items.filter(i => !i.hidden);
  return <div className="scene">
    <SceneBoundary>
      <Canvas key={terrain.name+(walk?'walk':'orbit')} camera={{ position: [center[0]+size*.24,size*.64,-center[1]+size*.60], far:Math.max(2000,size*10), near:.05 }}
        fallback={<div className="scene-fallback">WebGL no está disponible.</div>} onPointerMissed={publicProject ? undefined : () => editor.select()}>
        <color attach="background" args={['#13212d']}/>
        <ambientLight intensity={1.65}/>
        <directionalLight position={[50,100,65]} intensity={2.4}/>
        {photo && <Suspense fallback={null}><ReferenceSurface key={photo.url} reference={photo}/></Suspense>}
        {showTerrain && <Ground rings={terrain.rings} color="#263e40" opacity={photo ? .25 : 1}/>}
        {length && <Line points={length.map(([x,y]) => worldPosition(x,y,.085))} color="#80b5ff" lineWidth={2.5}
          dashed={!project.lengthLine} dashSize={3} gapSize={1.5}/>}
        {length && [length[0],length.at(-1)!].map(([x,y],i) => <mesh key={i} position={worldPosition(x,y,.22)}>
          <sphereGeometry args={[.48,12,8]}/><meshBasicMaterial color="#80b5ff"/>
        </mesh>)}
        {showTerrain && terrain.rings.map((ring,i) => <Line key={i} points={points(ring,.04)} color="#73e4c6" lineWidth={1.7}/>)}
        {scenario.zones.map(z => <group key={z.id}>
          <Ground rings={[z.ring]} height={.025} color={zoneColors[z.kind]} opacity={.32}/>
          <Line points={points(z.ring,.06)} color={zoneColors[z.kind]} lineWidth={1.2}/>
        </group>)}
        {visibleItems.map((i,index) => <RenderItem key={i.id} item={i} asset={lookup.get(i.assetId)!} selected={selected.includes(i.id)}
          sharedBase={index > 0 && fenceJoin(visibleItems[index-1],i)}
          alert={!!alerts[i.id]?.length} onSelect={publicProject ? undefined : extend => editor.select(i.id,extend)} loadModel={loadModel} onError={onError}/>)}
        {walk ? <Walk center={center} controls={publicProject ? controls.current : undefined}/> : <OrbitControls makeDefault target={worldPosition(...center)} maxPolarAngle={Math.PI/2-.01} maxDistance={size*6}/>}
      </Canvas>
    </SceneBoundary>
    {walk && publicProject && <div className="walk-pad" aria-label="Desplazamiento">
      {([['KeyW','↑','Avanzar'],['KeyA','←','Izquierda'],['KeyS','↓','Retroceder'],['KeyD','→','Derecha']] as const).map(([code,arrow,label]) =>
        <button key={code} type="button" aria-label={label} onPointerDown={e => {
          e.currentTarget.setPointerCapture(e.pointerId);
          controls.current.add(code);
        }} onLostPointerCapture={() => controls.current.delete(code)}>{arrow}</button>)}
    </div>}
    {walk && !publicProject && <button className="walk-start" id="walk-start">Iniciar recorrido · WASD · Esc para salir</button>}
  </div>;
}

