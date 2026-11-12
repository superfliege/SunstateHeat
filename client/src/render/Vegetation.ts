// Pflanzen-Varianten für das Instancing: bevorzugt Quaternius-Modelle (Stylized Nature MegaKit,
// 150+ LowPoly Nature), sonst die prozeduralen Ersatzmodelle aus plants.ts.
import * as THREE from 'three';
import { TreeType } from '../../../shared/src/world/WorldMap';
import { plantMat } from './models';
import { coverGeometry, treeGeometry, type CoverKind } from './plants';
import { vegetation, type VegCategory } from './quaternius';

export interface PlantVariant {
  key: string;
  parts: { geometry: THREE.BufferGeometry; material: THREE.Material }[];
  outline: boolean;
  shadow: boolean;
}

const cache = new Map<string, PlantVariant[]>();

function fromQuaternius(key: string, cat: VegCategory, shadow: boolean): PlantVariant[] {
  return (vegetation.get(cat) ?? []).map((m, i) => ({ key: `${key}:${i}`, parts: m.parts, outline: m.outline, shadow }));
}

function procedural(key: string, geo: THREE.BufferGeometry, outline: boolean, shadow: boolean): PlantVariant[] {
  return [{ key: `${key}:p`, parts: [{ geometry: geo, material: plantMat }], outline, shadow }];
}

/** Varianten für eine Baumart (TreeType). */
export function treeVariants(type: number): PlantVariant[] {
  const key = `tree:${type}`;
  let v = cache.get(key);
  if (v) return v;
  const cat: VegCategory | null = type === TreeType.Palm ? 'palm' : type === TreeType.Pine ? 'pine'
    : type === TreeType.Mangrove || type === TreeType.Cypress ? 'twisted' : type === TreeType.Oak ? 'broadleaf' : null;
  v = cat ? fromQuaternius(key, cat, true) : [];
  if (!v.length) v = procedural(key, treeGeometry(type), true, true);
  cache.set(key, v);
  return v;
}

/** Varianten für Bodendecker. */
export function coverVariants(kind: CoverKind): PlantVariant[] {
  const key = `cover:${kind}`;
  let v = cache.get(key);
  if (v) return v;
  const cat: Partial<Record<CoverKind, VegCategory>> = {
    grass: 'grass', bush: 'bush', rock: 'rock', reed: 'reed', fern: 'fern', flower: 'flower', lily: 'lily', cactus: 'cactus',
  };
  const big = kind === 'bush' || kind === 'rock' || kind === 'cactus' || kind === 'hay' || kind === 'haySquare' || kind === 'fenceWood' || kind === 'fenceWire' || kind === 'crate';
  v = cat[kind] ? fromQuaternius(key, cat[kind]!, big) : [];
  if (!v.length) v = procedural(key, coverGeometry(kind), big, big);
  cache.set(key, v);
  return v;
}

export function hasQuaterniusVegetation() { return vegetation.size > 0; }
