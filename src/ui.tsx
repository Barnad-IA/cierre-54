import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { activeScenario, changeScenario, useEditor } from './editor';
import { feltArea, isModularFence } from './fence';
import { footprint, validateRing } from './geo';
import { db, blobUrlData } from './storage';
import { calibrate, validateOrtho } from './ortho';
import { metric } from './plan';
import { categories, uid, zoneColors } from './types';
import type { Asset, Category, Item, Ortho, Project, Ring, SurveyPoint, Zone, ZoneKind } from './types';

export const kinds = Object.keys(zoneColors) as ZoneKind[];
export const errorText = (e: unknown) => e instanceof Error ? e.message : String(e);
export function Dialog({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); },[]);
  return <dialog ref={dialog} onCancel={e => { e.preventDefault(); close(); }} className="dialog">
    <header><h2>{title}</h2><button aria-label="Cerrar" onClick={close}>×</button></header>
    {children}
  </dialog>;
}
export function NumberField({ label, value, onChange, min, disabled }: { label: string; value: number; onChange: (n: number) => void; min?: number; disabled?: boolean }) {
  return <label>{label}<input key={value} type="number" min={min} step="any" defaultValue={value} disabled={disabled}
    onBlur={e => {
      const n = e.currentTarget.valueAsNumber;
      if (Number.isFinite(n) && (min === undefined || n >= min)) { if (value !== n) onChange(n); }
      else e.currentTarget.value = String(value);
    }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}/></label>;
}
export function AssetMark({ asset }: { asset: Asset }) {
  const [failed,setFailed] = useState<string>();
  const builtin = !asset.file && asset.builtin?.match(/^\/models\/(obj_[\w-]+|valla_modulo)\.glb$/);
  const src = asset.thumbnail || (builtin ? '/thumbnails/'+builtin[1]+'.png' : undefined);
  return src && src !== failed ? <img className="asset-mark" src={src} alt="" loading="lazy" draggable={false}
    onError={() => setFailed(src)}/> :
    <span className="asset-mark" style={{ color:asset.color }} aria-hidden="true">
      <svg viewBox="0 0 32 32" width="24" height="24"><path d="m16 4 11 6v12l-11 6-11-6V10l11-6Zm0 12 11-6m-11 6L5 10m11 6v12" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/></svg>
    </span>;
}
export function AssetDialog({ existing, close }: { existing?: Asset; close: () => void }) {
  const { edit } = useEditor();
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const files = data.getAll('files').filter((f): f is File => f instanceof File && !!f.size);
    const n = (k: string) => Number(data.get(k) || 0);
    const name = String(data.get('name')).trim();
    if (!name) { setError('Escribe un nombre para el modelo.'); return; }
    setBusy(true);
    setError('');
    try {
      let file = existing?.file, preview = existing?.thumbnail;
      let w = n('w'), d = n('d'), h = n('h');
      const yaw = n('yaw'), unit = n('unit');
      if (files.length) {
        const { parseModel, modelDimensions, rememberModel, thumbnail } = await import('./models');
        const original = files.map(f => ({ name:f.name, data:f }));
        const model = await parseModel(original);
        const dimensions = modelDimensions(model,yaw,unit);
        if (data.get('estimate')) { w ||= dimensions.x; d ||= dimensions.z; h ||= dimensions.y; }
        preview = thumbnail(model);
        file = uid();
        await db.models.put({ id:file, files:original });
        rememberModel(file,model);
      }
      const asset: Asset = { id:existing?.id || uid(), name, category:String(data.get('category')) as Category, w,d,h,yaw,unit,
        anchorX:n('anchorX'), anchorY:n('anchorY'), file, builtin:existing?.builtin, thumbnail:preview,
        color:existing?.color || '#82d9df', provisional:!w || !d || !h || !!data.get('provisional') || (!!files.length && !!data.get('estimate')) };
      edit(p => ({ ...p, assets:existing ? p.assets.map(a => a.id === existing.id ? asset : a) : [...p.assets,asset] }));
      close();
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }
  return <Dialog title={existing ? 'Configurar modelo' : 'Añadir al catálogo'} close={() => { if (!busy) close(); }}>
    <form onSubmit={e => void submit(e)} className="dialog-form">
      <label>Nombre<input name="name" required defaultValue={existing?.name}/></label>
      <label>Categoría<select name="category" defaultValue={existing?.category}>{categories.map(c => <option key={c}>{c}</option>)}</select></label>
      <label>Modelo GLB / glTF y recursos asociados<input type="file" name="files" multiple accept=".glb,.gltf,.bin,.png,.jpg,.jpeg,.webp"/></label>
      <label className="check"><input type="checkbox" name="estimate" defaultChecked={!existing}/> Estimar dimensiones vacías desde la malla</label>
      <div className="field-grid three">{(['w','d','h'] as const).map((key,i) => <label key={key}>{['Ancho (m)','Fondo (m)','Altura (m)'][i]}
        <input name={key} type="number" min="0" step="any" defaultValue={existing?.[key] || ''} placeholder="Pendiente"/></label>)}</div>
      <div className="field-grid"><label>Giro de origen (°)<input name="yaw" type="number" step="any" defaultValue={existing?.yaw ?? 0} required/></label>
      <label>Metros por unidad de malla<input name="unit" type="number" min="0.000001" step="any" defaultValue={existing?.unit ?? 1} required/></label></div>
      <div className="field-grid"><label>Anclaje este (m)<input name="anchorX" type="number" step="any" defaultValue={existing?.anchorX ?? 0} required/></label>
      <label>Anclaje norte (m)<input name="anchorY" type="number" step="any" defaultValue={existing?.anchorY ?? 0} required/></label></div>
      <label className="check"><input type="checkbox" name="provisional" defaultChecked={existing?.provisional ?? true}/> Dimensiones provisionales</label>
      <p className="muted">El anclaje corrige el desfase visual de la malla respecto a la huella. Las dimensiones del catálogo se aplican a las instancias nuevas.</p>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="primary" disabled={busy}>{busy ? 'Leyendo modelo…' : 'Guardar en catálogo'}</button>
    </form>
  </Dialog>;
}
function ScenarioItems({ items, assets, selected, select, alerts }: {
  items: Item[]; assets: Asset[]; selected: string[]; select: ReturnType<typeof useEditor.getState>['select']; alerts: Record<string,string[]>;
}) {
  const [expanded,setExpanded] = useState<Set<string>>(() => new Set());
  const [query,setQuery] = useState('');
  const normalize = (value: string) => value.toLocaleLowerCase('es').normalize('NFD').replace(/\p{Diacritic}/gu,'');
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  const matches = (value: string) => {
    const label = normalize(value);
    return terms.every(term => label.includes(term));
  };
  const entries = new Map<string,Item[]>();
  for (const item of items) {
    const key = item.group ? 'group:'+item.group : 'item:'+item.id;
    const entry = entries.get(key);
    if (entry) entry.push(item);
    else entries.set(key,[item]);
  }
  const selectedIds = new Set(selected);
  const assetsById = new Map(assets.map(asset => [asset.id,asset]));
  const row = (item: Item, index?: number) => {
    const asset = assetsById.get(item.assetId);
    return <button key={item.id} className={selectedIds.has(item.id) ? 'active' : ''}
    onClick={e => select(item.id,e.shiftKey,true)}>
      <span className="scenario-item-label">
        {asset && <AssetMark asset={asset}/>}
        <span>{item.hidden ? '◌ ' : item.locked ? '◆ ' : ''}{item.name}{index === undefined ? '' : ' '+(index+1)}</span>
      </span>
      {!!alerts[item.id]?.length && <span className="warn" aria-label="Con alertas">!</span>}
    </button>;
  };
  let groupNumber = 0;
  const results = Array.from(entries,([key,members]) => {
    if (members.length === 1) {
      const item = members[0];
      return matches(item.name+' '+item.category) ? row(item) : null;
    }
    const label = members.every(i => i.fencePanel) ? 'Línea de vallas'
      : members.every(i => i.category === 'Sillas') ? 'Fila de sillas' : 'Grupo';
    const title = label+' '+(++groupNumber);
    const indexed = members.map((item,index) => ({ item,index }));
    const shown = matches(title) ? indexed : indexed.filter(({ item,index }) =>
      matches(item.name+' '+(index+1)+' '+item.category));
    if (!shown.length) return null;
    const isOpen = expanded.has(key);
    const visible = members.find(i => !i.hidden);
    const active = members.some(i => selectedIds.has(i.id));
    const warnings = members.filter(i => alerts[i.id]?.length).length;
    return <div className="scenario-group" key={key}>
      <div className="scenario-group-bar">
        <button type="button" className={active ? 'active' : ''} aria-expanded={isOpen}
          onClick={() => setExpanded(previous => {
            const next = new Set(previous);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
          })}>
          <span>{isOpen ? '▾' : '▸'} {title}</span>
          <span>{warnings > 0 && <span className="warn" title={warnings+' con alertas'}>! </span>}{shown.length === members.length ? members.length : shown.length+' / '+members.length}</span>
        </button>
        <button type="button" aria-label={'Seleccionar '+title} title="Seleccionar grupo"
          onClick={e => select((visible ?? members[0]).id,e.shiftKey,!visible)}>⌖</button>
      </div>
      {isOpen && <div className="scenario-group-items">{shown.map(({ item,index }) => row(item,index))}</div>}
    </div>;
  }).filter(result => result !== null);
  return <>
    <input className="scenario-search" type="search" aria-label="Buscar objetos del escenario"
      placeholder="Buscar objetos o grupos…" value={query} onChange={e => setQuery(e.target.value)}/>
    {!items.length && <p className="muted">El escenario está vacío.</p>}
    {items.length > 0 && !results.length && <p className="muted" role="status">No hay objetos que coincidan con la búsqueda.</p>}
    {results}
  </>;
}
export function Inspector({ alerts }: { alerts: Record<string,string[]> }) {
  const editor = useEditor();
  const { selected, project, update, select } = editor;
  const items = activeScenario(project).items;
  const item = items.find(i => i.id === selected[0]);
  const [feltScope,setFeltScope] = useState('');
  const fenceAssets = new Set(project.assets.filter(isModularFence).map(a => a.id));
  const fences = items.filter(i => fenceAssets.has(i.assetId));
  const selectedFences = fences.filter(i => selected.includes(i.id));
  const scoped = selectedFences.find(i => i.id === feltScope);
  const targets = scoped ? [scoped] : selectedFences;
  const editable = targets.filter(i => !i.locked);
  const totalFelt = fences.reduce((sum,i) => sum+feltArea(i),0);
  const selectionFelt = targets.reduce((sum,i) => sum+feltArea(i),0);
  function setFelt(side: 1 | 2, enabled: boolean) {
    const ids = new Set(editable.map(i => i.id));
    editor.edit(p => changeScenario(p,s => ({ ...s,items:s.items.map(i => {
      if (!ids.has(i.id)) return i;
      const mask = (enabled ? (i.felt ?? 0) | side : (i.felt ?? 0) & ~side) as 0 | 1 | 2 | 3;
      return { ...i,felt:mask || undefined };
    }) })));
  }
  return <aside className="inspector">
    <div className="panel-title"><span className="panel-icon">◫</span><h2>Propiedades</h2></div>
    {item ? <div className="inspector-content" key={item.id}>
      <div className="object-title"><span className="eyebrow">{item.category}</span><h3>{item.name}</h3><span className="muted">{selected.length > 1 ? selected.length+' elementos seleccionados' : item.group ? 'Parte de un grupo' : 'Instancia del catálogo'}</span></div>
      <label>Nombre<input defaultValue={item.name} key={item.name} disabled={item.locked} onBlur={e => {
        const name = e.currentTarget.value.trim();
        if (name && name !== item.name) update(item.id,{ name });
        else e.currentTarget.value = item.name;
      }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}/></label>
      <h4>Posición y giro</h4>
      <div className="field-grid">{(['x','y','z','rotation'] as const).map((key,i) => <NumberField key={key} label={['X · Este (m)','Y · Norte (m)','Elevación (m)','Giro (°)'][i]}
        value={item[key]} disabled={item.locked} onChange={v => update(item.id,{ [key]:v })}/>)}</div>
      <h4>Dimensiones</h4>
      <div className="field-grid three">{(['w','d','h'] as const).map((key,i) => <NumberField key={key} label={['Ancho','Fondo','Alto'][i]+' (m)'}
        value={item[key]} min={0} disabled={item.locked} onChange={v => update(item.id,{ [key]:v })}/>)}</div>
      <p className="muted">{item.w && item.d ? metric(item.w*item.d)+' m² de huella' : 'Huella pendiente de dimensionar'}</p>
      {item.w > 0 && item.d > 0 && <details className="muted"><summary>Vértices de la huella</summary>{footprint(item).map(([x,y],i) => <div key={i}>{metric(x,3)} E · {metric(y,3)} N</div>)}</details>}
      {selectedFences.length > 0 && <fieldset className="felt-controls">
        <legend>Fieltro negro</legend>
        {selectedFences.length > 1 && <label>Aplicar a<select value={scoped?.id ?? ''} onChange={e => setFeltScope(e.target.value)}>
          <option value="">Vallas seleccionadas</option>
          {selectedFences.map((v,i) => <option key={v.id} value={v.id}>Panel {i+1}{v.locked ? ' · bloqueado' : ''}</option>)}
        </select></label>}
        {([1,2] as const).map(side => {
          const covered = targets.filter(i => (i.felt ?? 0) & side).length;
          return <label className="check" key={side}><input type="checkbox" checked={covered === targets.length}
            ref={node => { if (node) node.indeterminate = covered > 0 && covered < targets.length; }}
            disabled={!editable.length} onChange={e => setFelt(side,e.target.checked)}/>
            {side === 1 ? 'Cara frontal' : 'Cara posterior'}</label>;
        })}
        <p className="muted">Selección: ≈ {metric(selectionFelt)} m² de fieltro</p>
      </fieldset>}
      <h4>Registro</h4>
      <div className="field-grid"><label>Estado<select value={item.status} onChange={e => update(item.id,{ status:e.target.value })}>
        {[...new Set(['Pendiente','Confirmado','Retirado',item.status])].map(v => <option key={v}>{v}</option>)}
      </select></label><label>Costo (COP)<input type="number" min="0" step="any" defaultValue={item.cost ?? ''} key={item.cost}
        onBlur={e => { const value = e.currentTarget.valueAsNumber; const cost = Number.isFinite(value) && value >= 0 ? value : undefined; if (cost !== item.cost) update(item.id,{ cost }); }}/></label></div>
      <label>Observaciones<textarea rows={2} defaultValue={item.notes} key={item.notes} onBlur={e => { if (e.currentTarget.value !== item.notes) update(item.id,{ notes:e.currentTarget.value }); }}/></label>
      <div className="object-actions">
        <button onClick={editor.duplicate}>Duplicar</button><button onClick={editor.group} disabled={selected.length < 2 && !item.group}>Agrupar / separar</button>
        <button onClick={() => update(item.id,{ locked:!item.locked })}>{item.locked ? 'Desbloquear' : 'Bloquear'}</button>
        <button onClick={() => update(item.id,{ hidden:!item.hidden })}>{item.hidden ? 'Mostrar' : 'Ocultar'}</button>
        <button className="danger" disabled={item.locked && selected.length === 1} onClick={editor.remove}>Eliminar</button>
      </div>
      {!!alerts[item.id]?.length && <ul className="alerts">{alerts[item.id].map((m,i) => <li key={i}>{m}</li>)}</ul>}
    </div> : <div className="empty-inspector"><div>⌖</div><strong>Sin selección</strong><p>Selecciona un elemento en el plano o en la lista para editar sus propiedades.</p></div>}
    <section className="layers">{totalFelt > 0 && <p className="muted">Fieltro del escenario: ≈ {metric(totalFelt)} m²</p>}<h4>Elementos del escenario <span>{items.length}</span></h4>
      <ScenarioItems key={project.active} items={items} assets={project.assets} selected={selected} select={select} alerts={alerts}/>
    </section>
  </aside>;
}
export function ZoneDialog({ zone, marks, close }: { zone?: Zone; marks: Ring; close: () => void }) {
  const [error,setError] = useState('');
  const { edit } = useEditor();
  return <Dialog title={zone ? 'Editar zona' : 'Guardar zona'} close={close}>
    <form className="dialog-form" onSubmit={e => {
      e.preventDefault();
      const data = new FormData(e.currentTarget);
      try {
        const ring = String(data.get('ring')).trim().split(/\r?\n/).map(row => {
          const v = row.trim().split(/[\s;]+/).map(Number);
          if (v.length !== 2 || v.some(n => !Number.isFinite(n))) throw new Error('Cada línea debe contener X Y en metros, separados por un espacio.');
          return [v[0],v[1]] as [number,number];
        });
        validateRing(ring);
        const name = String(data.get('name')).trim();
        if (!name) throw new Error('Escribe un nombre para la zona.');
        const value = { id:zone?.id || uid(), name, kind:String(data.get('kind')) as ZoneKind, ring };
        edit(p => changeScenario(p,s => ({ ...s,zones:zone ? s.zones.map(z => z.id === zone.id ? value : z) : [...s.zones,value] })));
        close();
      } catch (err) { setError(errorText(err)); }
    }}>
      <label>Nombre<input name="name" defaultValue={zone?.name || 'Zona autorizada'} required/></label>
      <label>Tipo<select name="kind" defaultValue={zone?.kind}>{kinds.map(k => <option key={k}>{k}</option>)}</select></label>
      <label>Vértices X Y en metros<textarea name="ring" rows={5} required defaultValue={(zone?.ring || marks).map(p => p.join(' ')).join('\n')}/></label>
      <p className="muted">Los corredores, accesos y rutas reservan superficie. Sus trazados requieren revisión humana.</p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="dialog-actions"><button className="primary">Guardar zona</button>
      {zone && <button type="button" className="danger" onClick={() => {
        edit(p => changeScenario(p,s => ({ ...s,zones:s.zones.filter(z => z.id !== zone.id) }))); close();
      }}>Eliminar zona</button>}</div>
    </form>
  </Dialog>;
}
export function OrthoDialog({ project, close }: { project: Project; close: () => void }) {
  const [image,setImage] = useState<Pick<Ortho,'data'|'width'|'height'> | undefined>(project.ortho);
  const [rows,setRows] = useState(project.ortho?.points.map(p => [p.u,p.v,p.x,p.y].join(' ')).join('\n') || '');
  const [error,setError] = useState('');
  const [loading,setLoading] = useState(false);
  const edit = useEditor(s => s.edit);
  function readPoints(): SurveyPoint[] {
    return rows.trim().split(/\r?\n/).map(row => {
      const n = row.trim().split(/[\s;]+/).map(Number);
      if (n.length !== 4 || n.some(v => !Number.isFinite(v))) throw new Error('Cada fila debe contener u v X Y con separadores de espacio.');
      return { u:n[0],v:n[1],x:n[2],y:n[3] };
    });
  }
  let stats: ReturnType<typeof calibrate> | undefined;
  try { if (rows.trim()) stats = calibrate(readPoints()); } catch { /* Incomplete form */ }
  return <Dialog title="Calibrar ortofoto" close={close}>
    <form className="dialog-form" onSubmit={e => {
      e.preventDefault();
      try {
        if (!image) throw new Error('Selecciona una imagen.');
        const ortho = { ...image, points:readPoints(), visible:true };
        validateOrtho(ortho);
        edit(p => ({ ...p,ortho })); close();
      } catch (err) { setError(errorText(err)); }
    }}>
      <label>Ortofoto PNG, JPG o WebP<input type="file" accept="image/png,image/jpeg,image/webp" onChange={async e => {
        const file = e.target.files?.[0];
        if (!file) return;
        setLoading(true); setError('');
        try {
          if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Formato de imagen incompatible.');
          const data = await blobUrlData(file);
          const img = new Image(); img.src = data; await img.decode();
          setImage({ data,width:img.naturalWidth,height:img.naturalHeight });
        } catch (err) { setError(errorText(err)); }
        finally { setLoading(false); }
      }}/></label>
      {image && <div className="ortho-preview"><img src={image.data} alt="Vista previa de la ortofoto"/><span>{image.width} × {image.height} px</span></div>}
      <label>Controles u v X Y (una fila por punto)<textarea value={rows} onChange={e => setRows(e.target.value)} rows={4} placeholder={'u v X Y\n…'}/></label>
      <p className="muted">Introduce al menos tres puntos no alineados. u/v son píxeles desde la esquina superior izquierda. X/Y son metros locales desde el origen UTM del plano.</p>
      {stats && <p className="muted">{metric(stats.scale,5)} m/px · RMS {metric(stats.rms,3)} m · error máximo {metric(stats.maxError,3)} m</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="dialog-actions"><button className="primary" disabled={loading}>Aplicar ortofoto</button>
      {project.ortho && <button type="button" className="danger" onClick={() => { edit(p => ({ ...p,ortho:undefined })); close(); }}>Quitar imagen</button>}</div>
    </form>
  </Dialog>;
}

