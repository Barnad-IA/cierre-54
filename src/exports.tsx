import { renderToStaticMarkup } from 'react-dom/server';
import { activeScenario } from './editor';
import { bounds, ringArea, footprint } from './geo';
import { fitView, planBox, PlanGraphic } from './plan';
import type { Project } from './types';

export function download(name: string, file: Blob) {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url),2000);
}
const csvCell = (input: string | number) => {
  const text = String(input);
  return '"' + (/^[=+\-@\t\r]/.test(text) && typeof input === 'string' ? "'" : '') + text.replaceAll('"','""') + '"';
};
export function inventory(p: Project) {
  const rows = new Map<string, { label: string; count: number; dims: string; area: number }>();
  activeScenario(p).items.forEach(i => {
    const dims = [i.w,i.d,i.h].map(v => v || 'pendiente').join(' × ');
    const key = JSON.stringify([i.assetId,i.name,dims]);
    const row = rows.get(key) ?? { label:i.name, count:0, dims, area:0 };
    row.count++;
    row.area += ringArea(footprint(i));
    rows.set(key,row);
  });
  return '\uFEFF'+[['Elemento','Cantidad','Dimensiones (m)','Área sumada (m²)'],
    ...Array.from(rows.values(),r => [r.label,r.count,r.dims,Number(r.area.toFixed(4))])].map(row => row.map(csvCell).join(';')).join('\r\n');
}
async function raster(p: Project, alerts: Record<string,string[]>, ratio?: number) {
  const [l,b,r,t] = bounds(p.terrain.rings[0]);
  const mmPerM = ratio ? 1000/ratio : 0;
  const mmW = ratio ? (r-l)*mmPerM+28 : 0;
  const mmH = ratio ? (t-b)*mmPerM+28 : 0;
  if (ratio && (mmW > 1400 || mmH > 1400)) throw new Error('El plano supera 1.400 mm de lado. Elige una escala más pequeña.');
  const pxPerMm = ratio ? Math.min(6,4000/Math.max(mmW,mmH)) : 0;
  const width = ratio ? Math.ceil(mmW*pxPerMm) : 1800;
  const height = ratio ? Math.ceil(mmH*pxPerMm) : 1250;
  const fitted = fitView(p.terrain.rings,width,height,ratio ? 14*pxPerMm : 80);
  const view = ratio ? { ...fitted, zoom:mmPerM*pxPerMm } : fitted;
  const s = 1/view.zoom;
  const left = view.x-width*s/2, top = -view.y-height*s/2;
  const label = p.name+' · '+activeScenario(p).name+' · '+p.terrain.name+(ratio ? ' · 1:'+ratio : '')+(p.terrain.provisional ? ' · PROVISIONAL' : '');
  const step = [1,5,10,20,50,100,200,500].reduce((best,n) => Math.abs(n*view.zoom-125)<Math.abs(best*view.zoom-125)?n:best,1);
  const baseline = top+(height-24)*s;
  const svg = renderToStaticMarkup(<svg xmlns="http://www.w3.org/2000/svg" width={width} height={height} viewBox={planBox(view)}>
    <PlanGraphic project={p} items={activeScenario(p).items} view={view} alerts={alerts}/>
    <text x={left+24*s} y={top+32*s} fill="#e9fff9" fontSize={18*s} fontFamily="sans-serif">{label}</text>
    <text x={left+(width-64)*s} y={top+44*s} fill="#e9fff9" fontSize={18*s} fontFamily="sans-serif">N ↑</text>
    <path d={`M${left+24*s} ${baseline-5*s}v${5*s}h${step}v${-5*s}`} fill="none" stroke="#e9fff9" strokeWidth={2*s}/>
    <text x={left+24*s} y={baseline-9*s} fill="#e9fff9" fontSize={15*s} fontFamily="sans-serif">{step} m</text>
  </svg>);
  const url = URL.createObjectURL(new Blob([svg],{ type:'image/svg+xml;charset=utf-8' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')!.drawImage(image,0,0);
    return { canvas, mmW:ratio ? width/pxPerMm : 0, mmH:ratio ? height/pxPerMm : 0 };
  } finally {
    URL.revokeObjectURL(url);
  }
}
export async function exportPlan(project: Project, alerts: Record<string,string[]>, ratio?: number) {
  const { canvas, mmW, mmH } = await raster(project,alerts,ratio);
  if (ratio) {
    const { jsPDF } = await import('jspdf');
    const pdf = new jsPDF({ unit:'mm', format:[mmW,mmH], orientation:mmW > mmH ? 'landscape' : 'portrait', precision:8 });
    pdf.addImage(canvas,'PNG',0,0,mmW,mmH,undefined,'FAST');
    pdf.save('vueltabajero-1-'+ratio+'.pdf');
    return;
  }
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve,'image/png'));
  if (!blob) throw new Error('No se pudo generar el PNG.');
  download('vueltabajero-plano.png',blob);
}

