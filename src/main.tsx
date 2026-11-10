import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { activeScenario, useEditor } from './editor';
import { analyze, parseKml, parseLengthKml, perimeter, validateRing } from './geo';
import { isModularFence } from './fence';
import type { EventBackground } from './eventReference';
import { eventReference, lengthLabel } from './eventReference';
import { Plan, metric } from './plan';
import { exportProject, importProject, loadProject, saveProject } from './storage';
import { AssetDialog, AssetMark, Dialog, errorText, Inspector, OrthoDialog, ZoneDialog } from './ui';
import { categories, uid, zoneColors } from './types';
import type { PublicEvent } from './publicEvent';
import type { Asset, Point, Project, Ring, Tool, Zone } from './types';
import './style.css';

const Scene3D = lazy(() => import('./scene'));
const PublicRoute = lazy(() => import('./publicViewer'));
const PublicPreview = lazy(() => import('./publicViewer').then(module => ({ default:module.EventViewer })));
const ShareEvent = lazy(() => import('./shareEvent'));
const tools: { id: Tool; icon: string; name: string; hint: string }[] = [
  { id:'select',icon:'⌖',name:'Seleccionar',hint:'Arrastra desde el catálogo o mueve un objeto. Mayús + clic amplía la selección.' },
  { id:'distance',icon:'↔',name:'Distancia',hint:'Marca dos puntos en el plano para medir su distancia horizontal.' },
  { id:'area',icon:'⬠',name:'Área',hint:'Marca tres o más vértices y pulsa Finalizar área.' },
  { id:'width',icon:'⇤',name:'Paso',hint:'Marca los dos bordes de una sección transversal del paso.' },
  { id:'gap',icon:'⇥',name:'Entre objetos',hint:'Selecciona dos objetos dimensionados para medir la separación mínima entre sus huellas.' },
  { id:'chairs',icon:'▦',name:'Fila de sillas',hint:'Marca el centro de la primera silla y un segundo punto para indicar la dirección. Pulsa Enter para colocar la fila.' },
  { id:'fence',icon:'▥',name:'Línea de vallas',hint:'Marca los extremos y las esquinas. Pulsa Enter para colocar los módulos.' },
  { id:'zone',icon:'▧',name:'Dibujar zona',hint:'Marca tres o más vértices y guarda la geometría con el tipo de zona correspondiente.' },
];

function App() {
  const editor = useEditor();
  const { project, edit, tool, snap, past, future } = editor;
  const scenario = activeScenario(project);
  const result = useMemo(() => analyze(project.terrain,scenario.zones,scenario.items),[project.terrain,scenario.zones,scenario.items]);
  const alertCount = Object.values(result.alerts).reduce((n,a) => n+a.length,0);
  const [ready,setReady] = useState(false);
  const [saveState,setSaveState] = useState('Abriendo almacenamiento…');
  const [notice,setNotice] = useState('');
  const [busy,setBusy] = useState(false);
  const [view,setView] = useState<'2d'|'3d'|'walk'>('2d');
  const [position,setPosition] = useState<Point>([0,0]);
  const [zoom,setZoom] = useState(1);
  const [marks,setMarks] = useState<Ring>([]);
  const [areaFinished,setAreaFinished] = useState(false);
  const [gapIds,setGapIds] = useState<string[]>([]);
  const [chairCount,setChairCount] = useState('20');
  const [chairGap,setChairGap] = useState('0.15');
  const [placeId,setPlaceId] = useState<string>();
  const [query,setQuery] = useState('');
  const [category,setCategory] = useState('');
  const [tab,setTab] = useState<'catalog'|'zones'>('catalog');
  const [modal,setModal] = useState<'asset'|'zone'|'ortho'|'help'|'pdf'|'share'>();
  const [preview,setPreview] = useState<PublicEvent>();
  const [assetEdit,setAssetEdit] = useState<Asset>();
  const [zoneEdit,setZoneEdit] = useState<Zone>();
  const [layers,setLayers] = useState(true);
  const [properties,setProperties] = useState(true);
  const [showTerrain,setShowTerrain] = useState(() => {
    try { return localStorage.getItem('vueltabajero-show-terrain') !== 'false'; } catch { return true; }
  });
  const [background,setBackground] = useState<EventBackground>('clear');
  const reference = useMemo(() => eventReference(project.terrain),[project.terrain]);
  const length = showTerrain ? project.lengthLine?.points || reference?.points : undefined;
  const lineKml = useRef<HTMLInputElement>(null);
  const kml = useRef<HTMLInputElement>(null);
  const json = useRef<HTMLInputElement>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const importing = useRef(false);
  const pendingSaves = useRef(0);
  const loaded = useRef(false);

  const enqueue = useCallback((p: Project) => {
    pendingSaves.current++;
    setSaveState('Guardando…');
    const job = queue.current.catch(() => {}).then(() => saveProject(p)).finally(() => { pendingSaves.current--; });
    queue.current = job;
    void job.then(() => { if (queue.current === job) setSaveState('Guardado local'); })
      .catch(e => { if (queue.current === job) setSaveState('Error de guardado · '+errorText(e)); });
    return job;
  },[]);
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    void (async () => {
      try {
        const saved = await loadProject();
        if (saved) useEditor.getState().replace(saved);
        else {
          const response = await fetch('/data/terreno.kml');
          if (response.ok && !response.headers.get('content-type')?.includes('text/html')) {
            try {
              const terrain = parseKml(await response.text(),'terreno.kml');
              useEditor.getState().replace({ ...useEditor.getState().project, terrain });
            } catch (e) { setNotice('KML predeterminado: '+errorText(e)); }
          }
        }
        setReady(true);
        void enqueue(useEditor.getState().project).catch(() => {});
      } catch (e) {
        setNotice('Error de almacenamiento: '+errorText(e));
        setSaveState('Almacenamiento no disponible');
        setReady(true);
      }
    })();
    return useEditor.subscribe((state, previous) => {
      if (state.project !== previous.project && !importing.current) void enqueue(state.project).catch(() => {});
    });
  },[enqueue]);

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(''),8500);
    return () => clearTimeout(id);
  },[notice]);
  useEffect(() => {
    const protectSave = (e: BeforeUnloadEvent) => {
      if (pendingSaves.current || importing.current) {
        e.preventDefault();
        e.returnValue = true;
      }
    };
    addEventListener('beforeunload',protectSave);
    return () => removeEventListener('beforeunload',protectSave);
  },[]);
  const finishFence = useCallback(() => {
    try {
      const count = useEditor.getState().placeFence(marks);
      setMarks([]);
      setNotice(count+' '+(count === 1 ? 'módulo colocado.' : 'módulos colocados.'));
    } catch (e) { setNotice(errorText(e)); }
  },[marks]);
  const finishChairs = useCallback(() => {
    try {
      const count = useEditor.getState().placeChairs(marks,Number(chairCount),chairGap === '' ? NaN : Number(chairGap));
      setMarks([]);
      setNotice(count === 1 ? '1 silla colocada.' : count+' sillas colocadas.');
    } catch (e) { setNotice(errorText(e)); }
  },[marks,chairCount,chairGap]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (preview || document.querySelector('dialog[open]') || document.pointerLockElement || /INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement)?.tagName)) return;
      const { undo, redo, duplicate, remove, selected } = useEditor.getState();
      const drawingTool = useEditor.getState().tool;
      if (e.key === 'Enter' && (drawingTool === 'fence' || drawingTool === 'chairs') && marks.length >= 2) {
        e.preventDefault();
        if (!e.repeat) (drawingTool === 'chairs' ? finishChairs : finishFence)();
        return;
      }
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      if (ctrl && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
      if (ctrl && e.key.toLowerCase() === 'd' && selected.length) { e.preventDefault(); duplicate(); }
      if (ctrl && e.key.toLowerCase() === 's') { e.preventDefault(); void enqueue(useEditor.getState().project).catch(() => {}); }
      if (e.key === 'Delete' && selected.length) remove();
      if (e.key === 'Escape') { setPlaceId(undefined); setMarks([]); setAreaFinished(false); setGapIds([]); useEditor.setState({ tool:'select' }); }
    };
    addEventListener('keydown',handler);
    return () => removeEventListener('keydown',handler);
  },[enqueue,finishFence,finishChairs,marks.length,preview]);
  const modelError = useCallback((name: string) => setNotice('Se mostró una primitiva para '+name+' porque el modelo no pudo abrirse.'),[]);
  const onPlaced = useCallback(() => setPlaceId(undefined),[]);
  function resetTools(next: Tool = 'select') {
    setMarks([]); setGapIds([]); setPlaceId(undefined); setAreaFinished(false);
    useEditor.setState({ tool:next });
  }
  function chooseTool(next: Tool) {
    setView('2d');
    resetTools(next);
  }
  function chooseAsset(asset: Asset) {
    setView('2d');
    if (isModularFence(asset)) { resetTools('fence'); return; }
    resetTools(); setPlaceId(asset.id);
  }
  function finishArea() {
    try { validateRing(marks); setAreaFinished(true); }
    catch (e) { setNotice(errorText(e)); }
  }
  function closeModal() {
    setModal(undefined);
    setAssetEdit(undefined);
    setZoneEdit(undefined);
  }
  async function run(action: () => Promise<void>) {
    setBusy(true);
    try { await action(); }
    catch (e) { setNotice(errorText(e)); }
    finally { setBusy(false); }
  }
  const assets = project.assets.filter(a => (!category || a.category === category) &&
    (a.name+' '+a.category).toLocaleLowerCase('es').includes(query.trim().toLocaleLowerCase('es')));
  const selectedTool = tools.find(t => t.id === tool)!;
  const placeName = project.assets.find(a => a.id === placeId)?.name;
  const authorized = scenario.zones.some(z => z.kind === 'Autorizada');
  const formatArea = (n: number) => metric(n,1)+' m²';
  if (!ready) return <div className="boot">Abriendo Vueltabajero Event Planner…</div>;
  if (preview) return <Suspense fallback={<div className="boot">Abriendo vista previa…</div>}>
    <PublicPreview event={preview} onClose={() => { setPreview(undefined); setModal('share'); }}/>
  </Suspense>;
  return <main className="app" aria-busy={busy}>
    <header className="topbar">
      <div className="brand">
        <img className="brand-logo" src="/brand/vueltabajero-logo.webp" width="1000" height="656" alt="Vueltabajero, Salsa 100%"/>
        <div><h1>Vueltabajero <span>Event Planner</span></h1><p>CARTAGENA, COLOMBIA</p></div></div>
      <div className="header-actions">
        <button title="Deshacer (Ctrl+Z)" aria-label="Deshacer" disabled={!past.length || busy} onClick={() => { editor.undo(); resetTools(); }}>↶</button>
        <button title="Rehacer (Ctrl+Y)" aria-label="Rehacer" disabled={!future.length || busy} onClick={() => { editor.redo(); resetTools(); }}>↷</button>
        <button onClick={() => void enqueue(project).catch(() => {})} disabled={busy}>Guardar</button>
        <details className="menu"><summary>Importar <span>⌄</span></summary><div>
          <button disabled={busy} onClick={e => { e.currentTarget.closest('details')!.open=false; kml.current?.click(); }}>Terreno KML</button>
          <button disabled={busy} onClick={e => { e.currentTarget.closest('details')!.open=false; json.current?.click(); }}>Proyecto JSON</button>
          <button disabled={busy || project.terrain.provisional} onClick={e => { e.currentTarget.closest('details')!.open=false; lineKml.current?.click(); }}>Línea «largo» (KML)</button>
          <button onClick={e => { e.currentTarget.closest('details')!.open=false; setModal('ortho'); }}>Ortofoto calibrada</button>
        </div></details>
        <details className="menu"><summary className="primary">Exportar <span>⌄</span></summary><div onClick={e => { if ((e.target as HTMLElement).tagName === 'BUTTON') e.currentTarget.closest('details')!.open=false; }}>
          <button disabled={busy} onClick={() => void run(async () => {
            const { download } = await import('./exports');
            download('vueltabajero.json',new Blob([await exportProject(project)],{ type:'application/json' }));
          })}>Proyecto JSON</button>
          <button disabled={busy} onClick={() => void run(async () => {
            const { download, inventory } = await import('./exports');
            download('vueltabajero-inventario.csv',new Blob([inventory(project)],{ type:'text/csv;charset=utf-8' }));
          })}>Inventario CSV</button>
          <button disabled={busy} onClick={() => void run(async () => (await import('./exports')).exportPlan(project,result.alerts))}>Plano PNG</button>
          <button disabled={busy} onClick={() => setModal('pdf')}>Plano PDF a escala</button>
          <button disabled={busy} onClick={() => setModal('share')}>Compartir evento</button>
        </div></details>
        <button aria-label="Ayuda" title="Controles y coordenadas" onClick={() => setModal('help')}>?</button>
      </div>
    </header>
    <input ref={kml} hidden type="file" accept=".kml,application/vnd.google-earth.kml+xml" onChange={e => {
      const file = e.target.files?.[0]; e.target.value='';
      if (file) void run(async () => {
        const terrain = parseKml(await file.text(),file.name);
        const current = useEditor.getState().project;
        if ((current.ortho || current.lengthLine || current.scenarios.some(s => s.items.length || s.zones.length)) &&
            !window.confirm('El nuevo perímetro tiene otro origen. ¿Vaciar elementos, zonas, ortofoto y línea importada? Puedes deshacer esta acción.')) return;
        edit(p => ({ ...p, terrain, ortho:undefined, lengthLine:undefined, scenarios:p.scenarios.map(s => ({ ...s,items:[],zones:[] })) }));
        useEditor.setState({ selected:[] }); resetTools(); setView('2d');
        setNotice('Terreno importado · '+terrain.rings[0].length+' vértices.');
      });
    }}/>
    <input ref={lineKml} hidden type="file" accept=".kml,application/vnd.google-earth.kml+xml" onChange={e => {
      const file = e.target.files?.[0]; e.target.value='';
      if (file) void run(async () => {
        const terrain = useEditor.getState().project.terrain;
        if (terrain.provisional) throw new Error('Importa primero el terreno del evento.');
        const points = parseLengthKml(await file.text(),terrain.origin);
        edit(p => ({ ...p, lengthLine:{ name:file.name, points } }));
        setNotice('Línea «largo» importada.');
      });
    }}/>
    <input ref={json} hidden type="file" accept=".json,application/json" onChange={e => {
      const file = e.target.files?.[0]; e.target.value='';
      if (file) void run(async () => {
        const content = await file.text();
        if (!window.confirm('¿Abrir este archivo como proyecto activo? La importación se puede deshacer en esta sesión.')) return;
        importing.current = true;
        try {
          await queue.current.catch(() => {});
          const incoming = await importProject(content);
          edit(() => incoming); useEditor.setState({ selected:[] }); resetTools(); setView('2d');
          setSaveState('Guardado local'); setNotice('Proyecto importado.');
        } finally { importing.current = false; }
      });
    }}/>
    <div className="projectbar">
      <div className="project-meta"><span className="eyebrow">PROYECTO LOCAL</span>
        <input aria-label="Nombre del proyecto" key={project.name} defaultValue={project.name} onBlur={e => {
          const name = e.currentTarget.value.trim();
          if (name && name !== project.name) edit(p => ({ ...p,name })); else e.currentTarget.value=project.name;
        }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}/></div>
      <div className="scenario-menu"><label>Escenario <select aria-label="Escenario" value={project.active} onChange={e => {
        const active=e.target.value; edit(p => ({ ...p,active })); useEditor.setState({ selected:[] }); resetTools();
      }}>{project.scenarios.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <button title="Añadir escenario" aria-label="Añadir escenario" onClick={() => {
          const name = window.prompt('Nombre del escenario',String.fromCharCode(65+project.scenarios.length))?.trim();
          if (name) { const id=uid(); edit(p => ({ ...p,active:id,scenarios:[...p.scenarios,{ id,name,items:[],zones:[] }] })); useEditor.setState({ selected:[] }); resetTools(); }
        }}>+</button></div>
      <div className="save-state" title={saveState}><i className={saveState.startsWith('Guardado') ? 'synced' : ''}/>{saveState}</div>
    </div>
    <div className={'workspace '+(!layers ? 'no-catalog ' : '')+(!properties ? 'no-inspector' : '')}>
      {layers && <aside className="catalog">
        <div className="panel-title"><span className="panel-icon">◇</span><h2>Catálogo y zonas</h2></div>
        <div className="side-tabs"><button className={tab === 'catalog' ? 'active' : ''} onClick={() => setTab('catalog')}>Modelos</button>
          <button className={tab === 'zones' ? 'active' : ''} onClick={() => setTab('zones')}>Zonas <span>{scenario.zones.length}</span></button></div>
        {tab === 'catalog' ? <>
          <div className="catalog-filter">
            <input type="search" aria-label="Buscar modelo" placeholder="Buscar modelo…" value={query} onChange={e => setQuery(e.target.value)}/>
            <select value={category} aria-label="Filtrar por categoría" onChange={e => setCategory(e.target.value)}><option value="">Todas las categorías</option>
              {categories.map(c => <option key={c}>{c}</option>)}</select>
          </div>
          <div className="asset-list">
            {assets.map(a => <div className={'asset-row '+(a.id === placeId ? 'placing' : '')} key={a.id} draggable
              onDragStart={e => { e.dataTransfer.setData('application/x-event-asset',a.id); e.dataTransfer.effectAllowed='copy'; }}>
              <button className="asset-pick" title="Haz clic para colocar o arrastra al plano" onClick={() => chooseAsset(a)}>
                <AssetMark asset={a}/><span><strong>{a.name}</strong><small>{a.w && a.d ? metric(a.w)+' × '+metric(a.d)+' m' : 'Dimensiones pendientes'}{a.provisional && ' · Prov.'}</small></span>
              </button>
              <button className="asset-edit" aria-label={'Configurar '+a.name} title="Configurar modelo" onClick={() => { setAssetEdit(a); setModal('asset'); }}>⋯</button>
            </div>)}
            {!assets.length && <p className="muted">No hay modelos para este filtro.</p>}
          </div>
          <div className="panel-foot"><button className="outline" onClick={() => setModal('asset')}>＋ Añadir modelo</button></div>
        </> : <>
          <div className="zone-list">
            {!scenario.zones.length && <p className="muted">Dibuja una zona autorizada para calcular la superficie disponible.</p>}
            {scenario.zones.map(z => <button key={z.id} onClick={() => { setZoneEdit(z); setModal('zone'); }}>
              <i style={{ background:zoneColors[z.kind] }}/><span><strong>{z.name}</strong><small>{z.kind}</small></span><span>⋯</span></button>)}
          </div>
          <div className="panel-foot"><button className="outline" onClick={() => chooseTool('zone')}>＋ Dibujar zona</button></div>
        </>}
      </aside>}
      <section className="viewer" aria-label="Visor del terreno">
        <div className="viewer-header">
          <div><span className="eyebrow">ESPACIO DE TRABAJO</span><h2>Plano del evento</h2></div>
          <div className="view-actions">
            <button title="Mostrar u ocultar catálogo" aria-label="Alternar catálogo" aria-pressed={layers} onClick={() => setLayers(v => !v)}>☰</button>
            <div className="view-toggle" aria-label="Vista">
              {(['2d','3d','walk'] as const).map((id,i) => <button key={id} className={view === id ? 'active' : ''} aria-pressed={view === id}
                onClick={() => { resetTools(); setView(id); }}>{['Plano 2D','Vista 3D','Recorrido'][i]}</button>)}
            </div>
            <button title="Mostrar u ocultar propiedades" aria-label="Alternar propiedades" aria-pressed={properties} onClick={() => setProperties(v => !v)}>◫</button>
          </div>
        </div>
        <div className={'terrain-banner '+(project.terrain.provisional ? 'provisional' : '')}>
          <span>{project.terrain.provisional ? '⚠ Terreno provisional' : '◆ '+project.terrain.name}</span>
          <small>{project.terrain.provisional ? 'Geometría de práctica · importa el KML del evento' : project.terrain.rings[0].length+' vértices · perímetro '+metric(perimeter(project.terrain.rings[0]))+' m'}</small>
          {project.terrain.provisional && <button disabled={busy} onClick={() => kml.current?.click()}>Importar KML</button>}
          {!project.terrain.provisional && <button aria-pressed={showTerrain} onClick={() => {
            const visible = !showTerrain;
            setShowTerrain(visible);
            try { localStorage.setItem('vueltabajero-show-terrain',String(visible)); } catch { /* Keep the session preference. */ }
          }}>{showTerrain ? 'Ocultar zona KML' : 'Mostrar zona KML'}</button>}
          {project.ortho && <button onClick={() => edit(p => ({ ...p,ortho:{ ...p.ortho!,visible:!p.ortho!.visible } }))}>{project.ortho.visible ? 'Ocultar ortofoto' : 'Mostrar ortofoto'}</button>}
        </div>
        {(reference || length) && <div className="reference-bar">
          {reference && <label>Fondo aéreo <select value={background} onChange={e => setBackground(e.target.value as EventBackground)}>
            <option value="trees">Con árboles</option><option value="clear">Sin árboles</option><option value="none">Sin fondo</option>
          </select></label>}
          {length && <span><strong>{project.lengthLine ? 'Línea KML' : 'Trazado visual aproximado'}</strong> · {lengthLabel(length,!project.lengthLine)}</span>}
        </div>}
        <div className="toolbelt">
          {tools.map(t => <button key={t.id} className={view === '2d' && tool === t.id ? 'active' : ''} title={t.hint} onClick={() => chooseTool(t.id)}><span>{t.icon}</span>{t.name}</button>)}
          <label className="snap">Ajuste <select aria-label="Ajuste a cuadrícula" value={snap} onChange={e => useEditor.setState({ snap:Number(e.target.value) })}>
            <option value="0">Libre</option><option value="0.1">0,1 m</option><option value="0.5">0,5 m</option><option value="1">1 m</option></select></label>
        </div>
        {view === '2d' && tool === 'chairs' && <div className="toolbelt chair-options">
          <label>Cantidad de sillas<input type="number" min="1" max="500" step="1" value={chairCount} onChange={e => setChairCount(e.target.value)}/></label>
          <label>Separación libre (m)<input type="number" min="0" max="10" step="0.05" value={chairGap} onChange={e => setChairGap(e.target.value)}/></label>
        </div>}
        <div className="viewport">
          {view === '2d' ? <Plan showTerrain={showTerrain || project.terrain.provisional} background={background} alerts={result.alerts} marks={marks} areaFinished={areaFinished} setMarks={next => {
            if (tool === 'area' && areaFinished) { setMarks(next.slice(-1)); setAreaFinished(false); }
            else setMarks(next);
          }} gapIds={gapIds} setGapIds={setGapIds} placeId={placeId} onPlaced={onPlaced} onPosition={setPosition} onZoom={setZoom}/>
          : <Suspense fallback={<div className="scene-fallback">Cargando visor 3D…</div>}><Scene3D showTerrain={showTerrain || project.terrain.provisional} background={background} walk={view === 'walk'} alerts={result.alerts} onError={modelError}/></Suspense>}
        </div>
        <div className="map-hint">
          <span>{view === '3d' ? 'Arrastra para orbitar · rueda para acercar · botón derecho para desplazar' : view === 'walk' ? 'WASD para caminar · ratón para mirar · Esc para liberar el cursor' :
            placeName ? 'Haz clic en el plano para colocar '+placeName+'.' : tool === 'select' ? 'Selecciona un objeto y arrastra ↻ para girarlo · Rueda para acercar · Alt + arrastre para desplazar' : selectedTool.hint}</span>
          {view === '2d' && (placeId || marks.length > 0 || gapIds.length > 0) && <button onClick={() => resetTools(tool)}>Limpiar</button>}
          {tool === 'area' && marks.length >= 3 && !areaFinished && <button className="outline" onClick={finishArea}>Finalizar área</button>}
          {tool === 'chairs' && marks.length >= 2 && <button className="outline" onClick={finishChairs}>Colocar sillas (Enter)</button>}
          {tool === 'fence' && marks.length >= 2 && <button className="outline" onClick={finishFence}>Colocar vallas (Enter)</button>}
          {tool === 'zone' && marks.length >= 3 && <button className="outline" onClick={() => setModal('zone')}>Guardar zona</button>}
        </div>
      </section>
      {properties && <Inspector alerts={result.alerts}/>}
    </div>
    <footer className="statusbar">
      <span className="coordinates">{view === '2d' ? 'E '+metric(position[0])+' · N '+metric(position[1])+' m' : 'Este / norte / altura (m)'} <b>UTM 18N</b></span>
      {view === '2d' && <span title="Píxeles por metro">{metric(zoom,1)} px/m</span>}
      <span>Terreno <strong>{formatArea(result.site)}</strong></span>
      <span>Ocupada <strong>{formatArea(result.occupied)}</strong></span>
      <span title={authorized ? 'Superficie autorizada menos reservas y huellas' : 'Dibuja zonas autorizadas'}>Libre <strong>{authorized ? formatArea(result.free) : 'Sin definir'}</strong></span>
      <span>Bloqueada <strong>{formatArea(result.blocked)}</strong></span>
      <span className={alertCount ? 'warn' : 'ok'}>{alertCount ? '⚠ '+alertCount+' '+(alertCount === 1 ? 'alerta' : 'alertas') : '● Sin alertas de objetos'}</span>
    </footer>
    {notice && <div className="toast" role="status"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Cerrar aviso">×</button></div>}
    {busy && <div className="busy" role="status">Procesando archivo…</div>}
    {modal === 'asset' && <AssetDialog existing={assetEdit} close={closeModal}/>}
    {modal === 'zone' && <ZoneDialog zone={zoneEdit} marks={marks} close={() => { closeModal(); resetTools(); setTab('zones'); }}/>}
    {modal === 'ortho' && <OrthoDialog project={project} close={closeModal}/>}
    {modal === 'help' && <Dialog title="Controles y coordenadas" close={closeModal}><div className="dialog-form help">
      <p>Importa el KML del evento y dibuja las zonas autorizadas. Usa los polígonos reservados para registrar accesos, corredores, carreteras, obstáculos y exclusiones.</p>
      <p>Arrastra un modelo al plano o selecciónalo y haz clic sobre su posición. Usa Mayús + clic para agrupar una selección. Edita posición, giro y tamaño desde Propiedades.</p>
      <p>Rueda para acercar, Alt + arrastre para desplazar y ⌖ para encuadrar. Ctrl+Z deshace, Ctrl+Y rehace, Ctrl+D duplica y Supr elimina.</p>
      <p>Origen UTM 18N <strong>{project.terrain.provisional ? 'local de práctica' : metric(project.terrain.origin[0],3)+' E · '+metric(project.terrain.origin[1],3)+' N'}</strong>. X crece al este, Y al norte y la elevación es relativa al suelo del editor.</p>
      <p className="muted">Las huellas ocultas siguen contabilizándose. Las rutas y la disponibilidad del lugar requieren verificación en sitio.</p>
    </div></Dialog>}
    {modal === 'share' && <Suspense fallback={null}>
      <ShareEvent project={project} background={background} showTerrain={showTerrain || project.terrain.provisional}
        close={closeModal} preview={event => { closeModal(); setPreview(event); }}/>
    </Suspense>}
    {modal === 'pdf' && <Dialog title="Exportar plano PDF" close={closeModal}><form className="dialog-form" onSubmit={e => {
      e.preventDefault();
      const ratio = Number(new FormData(e.currentTarget).get('ratio'));
      if (!(ratio >= 1 && ratio <= 100000)) return;
      closeModal();
      void run(async () => (await import('./exports')).exportPlan(project,result.alerts,ratio));
    }}><label>Denominador (1:n)<input name="ratio" type="number" min="1" max="100000" required defaultValue="500"/></label>
      <p className="muted">El tamaño de página se ajusta al terreno. Imprime al 100 % y comprueba la escala con la regla incluida.</p><button className="primary">Exportar PDF</button></form></Dialog>}
  </main>;
}

const publicSlug = new URLSearchParams(location.search).get('evento');
createRoot(document.getElementById('root')!).render(publicSlug === null ? <App/> :
  <Suspense fallback={<div className="boot">Abriendo el mapa del evento…</div>}><PublicRoute slug={publicSlug}/></Suspense>);

