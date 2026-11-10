import type { Ortho, SurveyPoint } from './types';

export function calibrate(points: SurveyPoint[]) {
  if (points.length < 3 || points.some(p => [p.u,p.v,p.x,p.y].some(n => !Number.isFinite(n)))) throw new Error('Se requieren tres controles válidos.');
  const mean = (key: keyof SurveyPoint) => points.reduce((s, p) => s + p[key], 0) / points.length;
  const u = mean('u'), v = mean('v'), x = mean('x'), y = mean('y');
  let uu = 0, vv = 0, uv = 0, real = 0, imag = 0;
  for (const p of points) {
    const du = p.u-u, dv = v-p.v, dx = p.x-x, dy = p.y-y;
    uu += du*du;
    vv += dv*dv;
    uv += du*dv;
    real += du*dx + dv*dy;
    imag += du*dy - dv*dx;
  }
  const norm = uu+vv;
  if (uu*vv-uv*uv <= norm*norm*1e-8) throw new Error('Distribuye los controles en tres posiciones no alineadas.');
  const a = real/norm, b = imag/norm;
  const tx = x-a*u-b*v, ty = y-b*u+a*v;
  const scale = Math.hypot(a,b);
  const errors = points.map(p => Math.hypot(a*p.u+b*p.v+tx-p.x, b*p.u-a*p.v+ty-p.y));
  const rms = Math.sqrt(errors.reduce((sum,n) => sum+n*n,0)/errors.length);
  return { a,b,tx,ty,scale,rms,maxError: Math.max(...errors) };
}
export function validateOrtho(o: Ortho) {
  if (o.points.some(p => p.u < 0 || p.u > o.width || p.v < 0 || p.v > o.height)) throw new Error('Los controles deben caer dentro de la imagen.');
  const fit = calibrate(o.points);
  if (!(fit.scale > 0) || fit.maxError > 0.5) throw new Error('La calibración supera el error máximo de 0,50 m o tiene escala nula.');
  return fit;
}

