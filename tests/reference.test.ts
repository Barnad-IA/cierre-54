import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { catalog } from '../src/catalog';
import { analyze, parseKml, perimeter } from '../src/geo';

it('calcula las métricas del archivo de referencia incluido', () => {
  const source = readFileSync(new URL('../public/data/terreno.kml',import.meta.url),'utf8');
  const t = parseKml(source,'terreno.kml');
  expect(t.rings[0]).toHaveLength(26);
  expect(perimeter(t.rings[0])).toBeCloseTo(729.77,2);
  expect(analyze(t,[],[]).site).toBeCloseTo(7431.4,1);
});

it('empaqueta cada modelo del catálogo como un GLB válido para servir', () => {
  for (const asset of catalog) {
    if (!asset.builtin) continue;
    const glb = readFileSync(new URL('../public'+asset.builtin,import.meta.url));
    expect(glb.toString('ascii',0,4)).toBe('glTF');
    expect(glb.readUInt32LE(4)).toBe(2);
    expect(glb.readUInt32LE(8)).toBe(glb.length);
  }
});

it('ajusta la captura al terreno del evento y conserva el trazado aproximado', async () => {
  const { eventReference, lineLength } = await import('../src/eventReference');
  const source = readFileSync(new URL('../public/data/terreno.kml',import.meta.url),'utf8');
  const t = parseKml(source,'terreno.kml');
  const reference = eventReference(t)!;
  expect(reference.fit.maxError).toBeLessThan(3);
  expect(lineLength(reference.points)).toBeGreaterThan(325);
  expect(lineLength(reference.points)).toBeLessThan(365);
  expect(eventReference({ ...t,origin:[0,0] })).toBeUndefined();
});

it('alterna fondos sin cambiar su encuadre métrico', async () => {
  const { eventReference } = await import('../src/eventReference');
  const terrain = parseKml(readFileSync(new URL('../public/data/terreno.kml',import.meta.url),'utf8'),'terreno.kml');
  const reference = eventReference(terrain)!;
  const trees = reference.background('trees')!;
  const clear = reference.background('clear')!;
  expect(trees.url).not.toBe(clear.url);
  expect(trees.fit).toEqual(clear.fit);
  expect(trees.center).toEqual(clear.center);
  expect(reference.background('none')).toBeUndefined();
  for (const photo of [trees,clear]) {
    const png = readFileSync(new URL('../public'+photo.url,import.meta.url));
    expect(png.readUInt32BE(16)).toBe(photo.width);
    expect(png.readUInt32BE(20)).toBe(photo.height);
  }
});
