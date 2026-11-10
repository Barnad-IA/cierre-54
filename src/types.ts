export type Point = [number, number];
export type Ring = Point[];
export type Terrain = { name: string; provisional: boolean; origin: Point; rings: Ring[]; altitudes: (number | null)[][] };
export type ZoneKind = 'Autorizada' | 'Exclusión' | 'Carretera' | 'Obstáculo' | 'Circulación' | 'Emergencia' | 'Acceso';
export const zoneColors: Record<ZoneKind, string> = {
  Autorizada: '#4ed4a0', Exclusión: '#f16f79', Carretera: '#919fba', Obstáculo: '#f68c55',
  Circulación: '#7fbaff', Emergencia: '#f2d26c', Acceso: '#bc9bfa',
};
export type Zone = { id: string; name: string; kind: ZoneKind; ring: Ring };
export const categories = ['Escenarios', 'Comida', 'Bares', 'Baños', 'Carpas', 'Artistas', 'Plantas eléctricas', 'Sillas', 'Mesas', 'Vallas', 'Accesos', 'Seguridad', 'Vehículos'] as const;
export type Category = typeof categories[number];
export type Asset = {
  id: string; name: string; category: Category; w: number; d: number; h: number;
  yaw: number; unit: number; anchorX: number; anchorY: number; color: string; provisional: boolean;
  file?: string; builtin?: string; thumbnail?: string;
};
export type Item = {
  id: string; assetId: string; name: string; category: Category; w: number; d: number; h: number;
  x: number; y: number; z: number; rotation: number; locked: boolean; hidden: boolean;
  group?: string; fencePanel?: boolean; felt?: 1 | 2 | 3; status: string; cost?: number; notes: string;
};
export type Scenario = { id: string; name: string; items: Item[]; zones: Zone[] };
export type SurveyPoint = { u: number; v: number; x: number; y: number };
export type Ortho = { data: string; width: number; height: number; points: SurveyPoint[]; visible: boolean };
export type Project = { version: 1; name: string; terrain: Terrain; scenarios: Scenario[]; active: string; assets: Asset[]; ortho?: Ortho; lengthLine?: { name: string; points: Point[] } };
export type ModelFile = { name: string; data: Blob };
export type Tool = 'select' | 'distance' | 'area' | 'width' | 'gap' | 'zone' | 'fence' | 'chairs';
export const uid = () => crypto.randomUUID();

