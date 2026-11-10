import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { ComponentProps } from 'react';
import { Plan } from './plan';
import { decodePublicEvent, validEventSlug } from './publicEvent';
import type { PublicEvent } from './publicEvent';
import type { getModel } from './models';

const Scene = lazy(() => import('./scene'));
const ignore = () => {};

export function EventViewer({ event, onClose }: { event: PublicEvent; onClose?: () => void }) {
  const [view,setView] = useState<'2d'|'3d'|'walk'>('2d');
  const [modelError,setModelError] = useState('');
  const cache = useRef(new Map<string,ReturnType<typeof getModel>>());
  const loadModel = useCallback<NonNullable<ComponentProps<typeof Scene>['loadModel']>>(asset => {
    const key = asset.file || asset.builtin;
    if (!key) return;
    const files = asset.file ? event.files.get(asset.file) : undefined;
    if (asset.file && !files) return Promise.reject(new Error('Falta el modelo del evento.'));
    if (!cache.current.has(key)) cache.current.set(key,import('./models').then(models =>
      files ? models.parseModel(files) : models.getModel(asset)!));
    return cache.current.get(key);
  },[event.files]);
  const onModelError = useCallback((name: string) => setModelError('Vista simplificada para '+name+'.'),[]);
  return <main className="public-view">
    <header className="public-header">
      <div className="public-brand">
        <img className="brand-logo" src="/brand/vueltabajero-logo.webp" width="1000" height="656" alt="Vueltabajero, Salsa 100%"/>
        <div><span className="eyebrow">{onClose ? 'VISTA PREVIA' : 'MAPA DEL EVENTO'}</span><h1>{event.project.name}</h1></div>
      </div>
      {onClose && <button onClick={onClose}>Volver al editor</button>}
    </header>
    <nav className="public-nav" aria-label="Vistas del evento">
      {(['2d','3d','walk'] as const).map((mode,i) => <button key={mode} className={view === mode ? 'active' : ''} aria-pressed={view === mode}
        onClick={() => setView(mode)}>{['Plano 2D','Vista 3D','Recorrido'][i]}</button>)}
    </nav>
    <div className="viewport">
      {view === '2d' ? <Plan publicProject={event.project} showTerrain={event.showTerrain} background={event.background}
        alerts={{}} marks={[]} areaFinished={false} setMarks={ignore} gapIds={[]} setGapIds={ignore}
        onPlaced={ignore} onPosition={ignore} onZoom={ignore}/>
      : <Suspense fallback={<div className="scene-fallback">Cargando vista 3D…</div>}>
        <Scene publicProject={event.project} background={event.background} showTerrain={event.showTerrain}
          walk={view === 'walk'} alerts={{}} loadModel={loadModel} onError={onModelError}/>
      </Suspense>}
    </div>
    <footer className="public-help">
      {view === '2d' ? 'Arrastra para mover el plano. Usa + y − para acercar o alejar.'
        : view === '3d' ? 'Arrastra para girar. Usa la rueda o pellizca la pantalla para acercar.'
        : 'Arrastra para mirar. Muévete con las flechas de pantalla, las del teclado o WASD.'}
      {view !== '2d' && modelError && <span role="status"> {modelError}</span>}
    </footer>
  </main>;
}

export default function PublicRoute({ slug }: { slug: string }) {
  const [event,setEvent] = useState<PublicEvent>();
  const [error,setError] = useState('');
  useEffect(() => {
    if (!validEventSlug(slug)) return;
    const controller = new AbortController();
    void fetch('/eventos/'+slug+'.json',{ signal:controller.signal,cache:'no-cache' }).then(async response => {
      if (!response.ok || response.headers.get('content-type')?.includes('text/html')) throw new Error('El evento aún no está publicado o el enlace es incorrecto.');
      return decodePublicEvent(await response.text());
    }).then(value => {
      if (!controller.signal.aborted) setEvent(value);
    }).catch(e => {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'No se pudo abrir el evento.');
    });
    return () => controller.abort();
  },[slug]);
  if (!validEventSlug(slug)) return <div className="boot">El enlace del evento es inválido.</div>;
  if (error) return <div className="boot"><p role="alert">{error}</p></div>;
  return event ? <EventViewer event={event}/> : <div className="boot">Abriendo el mapa del evento…</div>;
}
