import { describe, expect, it } from 'vitest';
import { analyze, distance, footprint, gap, parseKml, perimeter, ringArea, snapTo, utm, validateRing } from '../src/geo';
import { calibrate, validateOrtho } from '../src/ortho';
import { newProject, catalog } from '../src/catalog';
import type { Item, Ring, Zone } from '../src/types';

const rect = (l: number,b: number,r: number,t: number): Ring => [[l,b],[r,b],[r,t],[l,t]];
const kml = (points: string) => '<kml xmlns="http://www.opengis.net/kml/2.2"><Placemark><Polygon><outerBoundaryIs><LinearRing><coordinates>'+
  points+'</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></kml>';
const shape = (values: Partial<Item> = {}): Item => ({
  id:'i', assetId:'carpa', name:'Carpa', category:'Artistas', x:5,y:5,z:0,w:3,d:3,h:0,rotation:0, locked:false,
  hidden:false, notes:'', status:'Pendiente', ...values,
});
const terrain = { ...newProject().terrain,rings:[rect(0,0,10,10)] };
const zone = (id: string, kind: Zone['kind'], ring: Ring): Zone => ({ id, kind, ring, name:id });

describe('UTM y KML', () => {
  it('proyecta el meridiano central y establece un origen local', () => {
    expect(utm(-75,0)[0]).toBeCloseTo(500000,5);
    expect(utm(-75,0)[1]).toBeCloseTo(0,5);
    const t = parseKml(kml('-75.50000,10.40000,4 -75.49990,10.40000,5 -75.49990,10.40010 -75.50000,10.40010 -75.50000,10.40000,4'),'fixture');
    expect(t.origin).toEqual(utm(-75.5,10.4));
    expect(t.rings[0]).toHaveLength(4);
    expect(t.rings[0][0]).toEqual([0,0]);
    expect(t.altitudes[0]).toEqual([4,5,null,null]);
    expect(ringArea(t.rings[0])).toBeCloseTo(121.05,0);
    expect(perimeter(t.rings[0])).toBeCloseTo(44,0);
  });
  it('rechaza XML incompleto, coordenadas inválidas y cruces', () => {
    expect(() => parseKml('<kml><broken>','bad')).toThrow();
    expect(() => parseKml(kml('-75,10 -75.1,oops -75,10.1'),'bad')).toThrow();
    expect(() => validateRing([[0,0],[4,4],[0,4],[3,0]])).toThrow();
  });
});
describe('huellas y superficies', () => {
  it('conserva 3 × 3 m al girar', () => {
    const tent = catalog.find(a => a.id === 'carpa')!;
    const r = footprint(shape({ w:tent.w,d:tent.d,rotation:45 }));
    expect(distance(r[0],r[1])).toBeCloseTo(3,8);
    expect(distance(r[1],r[2])).toBeCloseTo(3,8);
    expect(ringArea(r)).toBeCloseTo(9,8);
    expect(snapTo(1.12,.1)).toBe(1.1);
  });
  it('mide separación mínima y distingue un contacto de un choque', () => {
    const a = shape(), b = shape({ id:'b',x:8 });
    expect(gap(footprint(a),footprint(b))).toBe(0);
    expect(gap(footprint(a),footprint(shape({ x:9 })))).toBeCloseTo(1,8);
    const authorized = zone('full','Autorizada',rect(0,0,10,10));
    expect(analyze(terrain,[authorized],[a,b]).alerts.i).toEqual([]);
    expect(analyze(terrain,[authorized],[a,{ ...b,rotation:45 }]).alerts.i[0]).toContain('Choque');
  });
  it('calcula unión de huellas y descuenta exclusiones sin duplicar áreas', () => {
    const zones = [zone('ok','Autorizada',rect(0,0,10,10)),zone('reserve','Emergencia',rect(0,0,2,10))];
    const r = analyze(terrain,zones,[shape(),shape({ id:'duplicate',hidden:true })]);
    expect(r).toMatchObject({ site:100,occupied:9,blocked:20,usable:80,free:71 });
    expect(r.alerts.i).toHaveLength(1);
    const violations = analyze(terrain,zones,[shape({ x:1,rotation:30 })]);
    expect(violations.alerts.i).toHaveLength(3);
    expect(analyze(terrain,[],[shape()]).free).toBe(0);
    expect(analyze(terrain,[],[shape()]).alerts.i).toContain('Sin zona autorizada definida.');
  });
  it('considera los entrantes y huecos del perímetro', () => {
    const withHole = { ...terrain,rings:[rect(0,0,10,10),rect(4,4,6,6)] };
    const authorized = zone('whole','Autorizada',rect(0,0,10,10));
    expect(analyze(withHole,[authorized],[shape()])).toMatchObject({ site:96, free:91 });
    expect(analyze(withHole,[authorized],[shape()]).alerts.i).toContain('Fuera del perímetro.');
  });
});
it('valida la escala de una imagen y rechaza controles incompatibles', () => {
  const points = [{ u:0,v:0,x:5,y:12 },{ u:100,v:0,x:15,y:12 },{ u:0,v:100,x:5,y:2 }];
  expect(calibrate(points).scale).toBeCloseTo(.1,9);
  expect(calibrate(points).maxError).toBeCloseTo(0,9);
  expect(() => validateOrtho({ data:'',width:100,height:100,visible:true,points:[...points,{ u:100,v:100,x:90,y:70 }] })).toThrow();
});


it('proyecta un LineString al mismo origen métrico que el terreno', async () => {
  const { parseLengthKml } = await import('../src/geo');
  const origin = utm(-75.5,10.4);
  const xml = '<kml><Placemark><LineString><coordinates>-75.5,10.4,0 -75.499,10.4,0 -75.499,10.401,0</coordinates></LineString></Placemark></kml>';
  const points = parseLengthKml(xml,origin);
  expect(points[0]).toEqual([0,0]);
  expect(points[1][0]).toBeGreaterThan(100);
  expect(points[2][1]).toBeGreaterThan(100);
  expect(() => parseLengthKml('<kml/>',origin)).toThrow(/LineString/);
});

it('cuenta solo las caras cubiertas por fieltro', async () => {
  const { feltArea } = await import('../src/fence');
  const module = shape({ w:2.772,d:1.032,h:1.9165 });
  expect(feltArea(module)).toBe(0);
  expect(feltArea({ ...module,felt:1 })).toBeCloseTo(3.85);
  expect(feltArea({ ...module,felt:3 })).toBeCloseTo(7.70);
  expect(feltArea({ ...module,w:5.544,felt:2 })).toBeCloseTo(7.70);
});
