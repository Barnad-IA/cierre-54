import { useState } from 'react';
import { Dialog,errorText } from './ui';
import { decodePublicEvent,eventSlug,exportPublicEvent,validEventSlug } from './publicEvent';
import type { PublicEvent } from './publicEvent';
import type { EventBackground } from './eventReference';
import type { Project } from './types';

export default function ShareEvent({ project, background, showTerrain, close, preview }: {
  project: Project; background: EventBackground; showTerrain: boolean; close: () => void; preview: (event: PublicEvent) => void;
}) {
  const [slug,setSlug] = useState(eventSlug(project.name) || 'evento');
  const [site,setSite] = useState(location.origin);
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState('');
  let link = '';
  if (validEventSlug(slug)) {
    try {
      const url = new URL(site.trim());
      if (['https:','http:'].includes(url.protocol) && !url.username && !url.password) {
        link = new URL('/?evento='+slug,url.origin).href;
      }
    } catch { /* Wait for a complete URL. */ }
  }
  async function generate(previewOnly: boolean) {
    setBusy(true);
    setMessage('');
    try {
      const json = await exportPublicEvent(project,background,showTerrain);
      if (previewOnly) preview(await decodePublicEvent(json));
      else {
        const { download } = await import('./exports');
        download(slug+'.json',new Blob([json],{ type:'application/json' }));
        setMessage('Archivo listo. Agrégalo a public/eventos/ y vuelve a desplegar el sitio.');
      }
    } catch (e) { setMessage(errorText(e)); }
    finally { setBusy(false); }
  }
  return <Dialog title="Compartir evento" close={close}>
    <div className="dialog-form">
      <p>La copia pública incluye los objetos visibles del escenario activo, sus modelos y el mapa. Las notas, los costos y las zonas internas se quedan en tu proyecto.</p>
      <label>Nombre para el enlace<input value={slug} onChange={e => setSlug(eventSlug(e.target.value))}/></label>
      <label>Dirección de tu sitio en Vercel<input type="url" value={site} onChange={e => setSite(e.target.value)}
        placeholder="https://tu-proyecto.vercel.app"/></label>
      {link && <label>Enlace para visitantes<input value={link} readOnly onFocus={e => e.currentTarget.select()}/></label>}
      <div className="dialog-actions">
        <button className="primary" disabled={busy || !validEventSlug(slug)} onClick={() => void generate(false)}>Descargar archivo público</button>
        <button disabled={busy} onClick={() => void generate(true)}>Vista previa</button>
        <button disabled={!link} onClick={async () => {
          try { await navigator.clipboard.writeText(link); setMessage('Enlace copiado. Funcionará cuando el archivo esté desplegado.'); }
          catch { setMessage('Selecciona y copia el enlace del campo de arriba.'); }
        }}>Copiar enlace</button>
      </div>
      <p className="muted">Guarda el archivo como <strong>public/eventos/{slug || 'evento'}.json</strong> en GitHub. Cuando Vercel termine de desplegarlo, el enlace estará listo para compartir.</p>
      {message && <p role="status">{message}</p>}
    </div>
  </Dialog>;
}
