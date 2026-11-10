import { useEffect, useId, useRef, useState } from 'react';
import type { PointerEvent as ReactPointer, ReactNode } from 'react';
import { bounds, distance, footprint, gap, ringArea, snapTo } from './geo';
import { activeScenario, useEditor } from './editor';
import type { EventBackground } from './eventReference';
import { eventReference } from './eventReference';
import { validateOrtho } from './ortho';
import { zoneColors } from './types';
import type { Item, Point, Project, Ring } from './types';

export type View = { x: number; y: number; zoom: number; width: number; height: number };
export const path = (ring: Ring) => ring.length ? 'M' + ring.map(([x,y]) => x + ',' + -y).join('L') + 'Z' : '';
export const metric = (n: number, digits = 2) => n.toLocaleString('es-CO', { maximumFractionDigits: digits });
export function fitView(rings: Ring[], width: number, height: number, margin = 48): View {
  const [l,b,r,t] = bounds(rings[0]);
  return { x: (l+r)/2, y: (b+t)/2, width, height, zoom: Math.max(0.01, Math.min((width-2*margin)/(r-l), (height-2*margin)/(t-b))) };
}
export function planBox(v: View) {
  return [v.x-v.width/2/v.zoom, -v.y-v.height/2/v.zoom, v.width/v.zoom, v.height/v.zoom].join(' ');
}
export const itemRing = (i: Item) => i.w > 0 && i.d > 0 ? footprint(i) : footprint({ ...i, w: 1, d: 1 });
const linePoints = (p: Ring) => p.map(([x,y]) => x+','+-y).join(' ');
const mapScale = (zoom: number) => [0.1,0.5,1,2,5,10,20,50,100,200,500,1000].reduce((best,n) =>
  Math.abs(n*zoom-95) < Math.abs(best*zoom-95) ? n : best, 0.1);

export function PlanGraphic({ project, view, items, selected = [], alerts = {}, marks = [], fillMarks, onItem, children, grid = true, background, showTerrain = true }:
  { project: Project; view: View; items: Item[]; selected?: string[]; alerts?: Record<string,string[]>; marks?: Ring; fillMarks?: boolean;
    onItem?: (event: ReactPointer<SVGElement>, item: Item) => void; children?: ReactNode; grid?: boolean; background?: EventBackground; showTerrain?: boolean }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g,'');
  const terrain = project.terrain.rings.map(path).join(' ');
  const ortho = project.ortho?.visible ? project.ortho : undefined;
  const fit = ortho && validateOrtho(ortho);
  const reference = background ? eventReference(project.terrain) : undefined;
  const photo = background && reference?.background(background);
  const length = showTerrain ? project.lengthLine?.points || reference?.points : undefined;
  const colors = new Map(project.assets.map(a => [a.id,a.color]));
  const scale = 1/view.zoom;
  return <>
    <defs>
      <pattern id={id+'m'} width="1" height="1" patternUnits="userSpaceOnUse">
        <path d="M1 0H0V1" fill="none" stroke="#273741" strokeWidth={0.55*scale}/>
      </pattern>
      <pattern id={id+'d'} width="10" height="10" patternUnits="userSpaceOnUse">
        <rect width="10" height="10" fill={view.zoom >= 2 ? 'url(#'+id+'m)' : 'none'}/>
        <path d="M10 0H0V10" fill="none" stroke="#344751" strokeWidth={0.9*scale}/>
      </pattern>
      <clipPath id={id+'site'}><path d={terrain} clipRule="evenodd"/></clipPath>
    </defs>
    <rect x={view.x-view.width*scale/2} y={-view.y-view.height*scale/2} width={view.width*scale} height={view.height*scale} fill="#121e28"/>
    {grid && <rect x={view.x-view.width*scale/2} y={-view.y-view.height*scale/2} width={view.width*scale} height={view.height*scale} fill={'url(#'+id+'d)'}/>}
    {photo && !ortho && <image href={photo.url} width={photo.width} height={photo.height} opacity=".57"
      transform={`matrix(${photo.fit.a} ${-photo.fit.b} ${photo.fit.b} ${photo.fit.a} ${photo.fit.tx} ${-photo.fit.ty})`}/>}
    {showTerrain && <path className="terrain-layer" d={terrain} fill="#2a6659" fillOpacity=".23" fillRule="evenodd"/>}
    {ortho && fit && <g clipPath={'url(#'+id+'site)'}>
      <image href={ortho.data} width={ortho.width} height={ortho.height} opacity=".8"
        transform={`matrix(${fit.a} ${-fit.b} ${fit.b} ${fit.a} ${fit.tx} ${-fit.ty})`}/>
    </g>}
    {showTerrain && <path className="terrain-layer" d={terrain} fill="none" stroke="#6ee6c6" strokeWidth={1.5*scale} strokeLinejoin="round"/>}
    {activeScenario(project).zones.map(z => <g key={z.id}>
      <path d={path(z.ring)} fill={zoneColors[z.kind]} fillOpacity=".19" stroke={zoneColors[z.kind]} strokeWidth={scale} strokeDasharray={3*scale+' '+2*scale}/>
      <text x={z.ring[0][0]} y={-z.ring[0][1]-4*scale} fill={zoneColors[z.kind]} fontSize={10*scale}>{z.name}</text>
    </g>)}
    {length && <g pointerEvents="none">
      <polyline points={linePoints(length)} fill="none" stroke="#73aaff" strokeWidth={2*scale} strokeDasharray={project.lengthLine ? undefined : 5*scale+' '+3*scale}/>
      {[length[0],length.at(-1)!].map(([x,y],i) => <circle key={i} cx={x} cy={-y} r={3.5*scale} fill="#73aaff" stroke="#10243b" strokeWidth={scale}/>)}
    </g>}
    {items.filter(i => !i.hidden).map(i => {
      const picked = selected.includes(i.id);
      const color = colors.get(i.assetId) || '#add7ef';
      const ring = itemRing(i);
      return <g key={i.id} onPointerDown={e => onItem?.(e,i)} className="plan-item">
        <path d={path(ring)} fill={color} fillOpacity={picked ? '.52' : '.30'} stroke={picked ? '#fff' : alerts[i.id]?.length ? '#ff9479' : color}
          strokeDasharray={!i.w || !i.d ? 3*scale+' '+2*scale : undefined} strokeWidth={(picked ? 2 : 1.2)*scale}/>
        <circle cx={i.x} cy={-i.y} r={2*scale} fill={color}/>
        {(picked || view.zoom*Math.max(i.w,i.d) > 22) && <text x={i.x} y={-i.y-6*scale} textAnchor="middle" fontSize={10*scale}
          fontWeight="600" fill="#fff" stroke="#121e28" strokeWidth={2.8*scale} paintOrder="stroke">{i.name}{i.locked ? ' · bloqueado' : ''}</text>}
      </g>;
    })}
    {marks.length > 0 && <g pointerEvents="none">
      {fillMarks && marks.length >= 3 ? <path d={path(marks)} fill="#f7dc81" fillOpacity=".15" stroke="#f7dc81" strokeWidth={1.5*scale}/>
        : <polyline points={linePoints(marks)} fill="none" stroke="#f7dc81" strokeWidth={1.5*scale}/>}
      {marks.map(([x,y],i) => <circle key={i} cx={x} cy={-y} r={3*scale} fill="#f7dc81"/>)}
    </g>}
    {children}
  </>;
}
const pointerAngle = (center: Point, point: Point) => Math.atan2(point[1]-center[1],point[0]-center[0])*180/Math.PI;
const normalizeAngle = (angle: number) => ((angle % 360) + 360) % 360;

type Drag = { kind: 'rotate'; id: string; center: Point; start: number; initial: number; angle: number } |
  { kind: 'pan'; px: number; py: number; x: number; y: number } |
  { kind: 'items'; start: Point; source: Record<string,Point>; anchor: string };

export function Plan({ publicProject, showTerrain, background, alerts, marks, areaFinished, setMarks, gapIds, setGapIds, placeId, onPlaced, onPosition, onZoom }:
  { publicProject?: Project; showTerrain: boolean; background: EventBackground; alerts: Record<string,string[]>; marks: Ring; areaFinished: boolean; setMarks: (p: Ring) => void; gapIds: string[]; setGapIds: (p: string[]) => void;
    placeId?: string; onPlaced: () => void; onPosition: (p: Point) => void; onZoom: (zoom: number) => void }) {
  const editor = useEditor();
  const project = publicProject ?? editor.project;
  const { snap } = editor;
  const selected = publicProject ? [] : editor.selected;
  const tool = publicProject ? 'select' : editor.tool;
  const items = activeScenario(project).items;
  const svg = useRef<SVGSVGElement>(null);
  const [view,setView] = useState(() => fitView(project.terrain.rings, 800, 600));
  const drag = useRef<Drag | null>(null);
  const pending = useRef<Record<string,Point>>({});
  const [preview,setPreview] = useState<Record<string,Point>>({});
  const [turn,setTurn] = useState<number>();
  const [cursor,setCursor] = useState<Point>();
  const terrain = project.terrain;
  useEffect(() => {
    const node = svg.current!;
    let first = true;
    const observer = new ResizeObserver(([entry]) => {
      const { width,height } = entry.contentRect;
      if (!width || !height) return;
      setView(v => first ? fitView(terrain.rings,width,height) : { ...v,width,height });
      first = false;
    });
    observer.observe(node);
    return () => observer.disconnect();
  },[terrain]);
  useEffect(() => onZoom(view.zoom), [onZoom,view.zoom]);
  function getPoint(e: { clientX: number; clientY: number }) {
    const rect = svg.current!.getBoundingClientRect();
    return [view.x+(e.clientX-rect.left-view.width/2)/view.zoom, view.y-(e.clientY-rect.top-view.height/2)/view.zoom] as Point;
  }
  const snapped = (p: Point): Point => [snapTo(p[0],snap),snapTo(p[1],snap)];
  useEffect(() => {
    const node = svg.current!;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = node.getBoundingClientRect();
      setView(v => {
        const zoom = Math.max(.015,Math.min(900,v.zoom*Math.exp(-e.deltaY*.0015)));
        const dx = e.clientX-rect.left-v.width/2, dy = e.clientY-rect.top-v.height/2;
        return { ...v, zoom, x: v.x+dx/v.zoom-dx/zoom, y: v.y-dy/v.zoom+dy/zoom };
      });
    };
    node.addEventListener('wheel',wheel,{ passive:false });
    return () => node.removeEventListener('wheel',wheel);
  },[]);
  function begin(e: ReactPointer<SVGElement>, item?: Item) {
    e.stopPropagation();
    if (e.button === 1 || e.button === 2 || (e.button === 0 && (e.altKey || publicProject))) {
      drag.current = { kind:'pan', px:e.clientX, py:e.clientY, x:view.x, y:view.y };
      svg.current!.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    const p = getPoint(e);
    if (placeId) {
      const asset = project.assets.find(a => a.id === placeId);
      if (asset) editor.place(asset,p);
      onPlaced();
    } else if (tool === 'gap' && item) {
      if (!(item.w && item.d)) return;
      setGapIds(gapIds.length === 1 && gapIds[0] !== item.id ? [...gapIds,item.id] : [item.id]);
    } else if (tool === 'distance' || tool === 'width') {
      setMarks(marks.length === 1 ? [...marks,snapped(p)] : [snapped(p)]);
    } else if (tool === 'area' || tool === 'zone' || tool === 'fence' || (tool === 'chairs' && marks.length === 1) || tool === 'chairs') {
      setMarks(tool === 'chairs' && marks.length >= 2 ? [snapped(p)] : [...marks,snapped(p)]);
    } else if (tool === 'select') {
      if (!item || e.shiftKey || !selected.includes(item.id)) editor.select(item?.id,e.shiftKey);
      if (!item || item.locked || e.shiftKey) return;
      const ids = useEditor.getState().selected;
      const source = Object.fromEntries(items.filter(i => ids.includes(i.id) && !i.locked).map(i => [i.id,[i.x,i.y] as Point]));
      drag.current = { kind:'items', start:p, source, anchor:item.id };
      svg.current!.setPointerCapture(e.pointerId);
    }
  }
  function beginRotation(e: ReactPointer<SVGGElement>, item: Item) {
    if (e.button !== 0) return;
    e.stopPropagation();
    drag.current = { kind:'rotate', id:item.id, center:[item.x,item.y],
      start:pointerAngle([item.x,item.y],getPoint(e)), initial:item.rotation, angle:item.rotation };
    svg.current!.setPointerCapture(e.pointerId);
  }
  function move(e: ReactPointer<SVGSVGElement>) {
    const p = getPoint(e);
    onPosition(p);
    setCursor(snapped(p));
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'pan') {
      setView(v => ({ ...v, x:d.x-(e.clientX-d.px)/v.zoom, y:d.y+(e.clientY-d.py)/v.zoom }));
      return;
    }
    if (d.kind === 'rotate') {
      if (distance(d.center,p)*view.zoom < 5) return;
      const step = e.shiftKey ? 15 : 1;
      d.angle = normalizeAngle(Math.round((d.initial+pointerAngle(d.center,p)-d.start)/step)*step);
      setTurn(d.angle);
      return;
    }
    const [x,y] = d.source[d.anchor];
    const next = snapped([x+p[0]-d.start[0],y+p[1]-d.start[1]]);
    if (distance(d.start,p)*view.zoom < 2 && Object.keys(pending.current).length === 0) return;
    pending.current = Object.fromEntries(Object.entries(d.source).map(([id,[u,v]]) => [id,[u+next[0]-x,v+next[1]-y]]));
    setPreview(pending.current);
  }
  function end(commit: boolean) {
    if (commit && Object.keys(pending.current).length) editor.move(pending.current);
    const active = drag.current;
    if (commit && active?.kind === 'rotate' &&
        normalizeAngle(active.initial) !== active.angle) editor.update(active.id,{ rotation:active.angle });
    pending.current = {};
    setPreview({});
    setTurn(undefined);
    drag.current = null;
  }
  const rotating = drag.current?.kind === 'rotate' ? drag.current.id : undefined;
  const shown = items.map(i => {
    if (i.id === rotating && turn !== undefined) return { ...i,rotation:turn };
    return preview[i.id] ? { ...i,x:preview[i.id][0],y:preview[i.id][1] } : i;
  });
  const target = tool === 'select' && !placeId && selected.length === 1
    ? shown.find(i => i.id === selected[0] && !i.hidden && !i.locked) : undefined;
  const radius = target ? (target.d || 1)/2+25/view.zoom : 0;
  const heading = (target?.rotation ?? 0)*Math.PI/180;
  const handleX = (target?.x ?? 0)-Math.sin(heading)*radius;
  const handleY = -(target?.y ?? 0)-Math.cos(heading)*radius;
  const handleScale = 1/view.zoom;
  const measured = gapIds.map(id => items.find(i => i.id === id)).filter((i): i is Item => !!i);
  const result = tool === 'gap' && measured.length === 2 ? metric(gap(footprint(measured[0]),footprint(measured[1])))+' m'
    : tool === 'area' && areaFinished && marks.length >= 3 ? metric(ringArea(marks))+' m²'
    : (tool === 'width' || tool === 'distance') && marks.length === 2 ? metric(distance(marks[0],marks[1]))+' m' : '';
  const scale = mapScale(view.zoom);
  const showCursor = cursor && marks.length > 0 && (tool === 'zone' || tool === 'fence' || (tool === 'area' && !areaFinished) || (marks.length === 1 && (tool === 'width' || tool === 'distance')));
  return <div className="map">
    <svg ref={svg} className={'plan '+(tool !== 'select' || placeId ? 'crosshair' : '')} viewBox={planBox(view)}
      onContextMenu={e => e.preventDefault()} onPointerDown={begin} onPointerMove={move}
      onPointerUp={() => end(true)} onPointerCancel={() => end(false)} onLostPointerCapture={() => end(false)}
      onPointerLeave={() => setCursor(undefined)}
      onDragOver={publicProject ? undefined : e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
      onDrop={publicProject ? undefined : e => {
        e.preventDefault();
        const asset = project.assets.find(a => a.id === e.dataTransfer.getData('application/x-event-asset'));
        if (asset) { editor.place(asset,getPoint(e)); onPlaced(); }
      }}>
      <PlanGraphic project={project} showTerrain={showTerrain} background={background} items={shown} view={view} selected={tool === 'gap' ? gapIds : selected} alerts={alerts} marks={marks}
        fillMarks={tool === 'zone' || tool === 'area'} onItem={begin}>
        {showCursor && <polyline points={linePoints([marks.at(-1)!,cursor])} stroke="#f7dc81" strokeWidth={1/view.zoom} strokeDasharray={3/view.zoom+' '+3/view.zoom} pointerEvents="none"/>}
        {target && <g className="rotate-handle" role="button" tabIndex={0}
          aria-label={'Girar '+target.name} onPointerDown={e => beginRotation(e,target)}
          onKeyDown={e => {
            const increments: Record<string,number> = { ArrowLeft:15,ArrowRight:-15,Enter:-15,' ':-15 };
            const change = increments[e.key];
            if (change === undefined) return;
            e.preventDefault();
            editor.update(target.id,{ rotation:normalizeAngle(target.rotation+change) });
          }}>
          <title>Arrastra para girar. Mayús ajusta a 15°. Usa ← o → con el teclado.</title>
          <line x1={target.x} y1={-target.y} x2={handleX} y2={handleY} stroke="#83d8ff" strokeWidth={1.5*handleScale} pointerEvents="none"/>
          <g transform={`translate(${handleX} ${handleY}) scale(${handleScale})`}>
            <circle r="15" fill="transparent"/>
            <circle r="11" fill="#163549" stroke="#83d8ff" strokeWidth="1.5"/>
            <path d="M4 -4 A5.5 5.5 0 1 0 5.5 1 M4 -7 V-4 H1" fill="none" stroke="#d4f2ff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </g>
        </g>}
      </PlanGraphic>
    </svg>
    <div className="north" title="Norte de cuadrícula UTM"><span>N</span><span>↑</span></div>
    <div className="map-controls">
      <button title="Acercar" onClick={() => setView(v => ({ ...v, zoom:Math.min(900,v.zoom*1.35) }))}>+</button>
      <button title="Alejar" onClick={() => setView(v => ({ ...v, zoom:Math.max(.015,v.zoom/1.35) }))}>−</button>
      <button title="Encuadrar terreno" onClick={() => setView(v => fitView(terrain.rings,v.width,v.height))}>⌖</button>
    </div>
    <div className="map-scale"><div>{metric(scale)} m</div><div className="scale-rule" style={{ width:scale*view.zoom }}/></div>
    {turn !== undefined && <output className="measurement">Giro <strong>{turn}°</strong></output>}
    {result && <output className="measurement">{tool === 'gap' ? 'Separación entre huellas' : tool === 'area' ? 'Área' : tool === 'width' ? 'Ancho medido' : 'Distancia'} <strong>{result}</strong></output>}
  </div>;
}

