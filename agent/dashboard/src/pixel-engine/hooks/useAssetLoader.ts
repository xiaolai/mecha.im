/**
 * Browser-side asset loader for the pixel office engine.
 *
 * Loads character, floor, wall, and furniture PNG assets from the public folder,
 * decodes them using OffscreenCanvas, and injects them into the engine's
 * module-level state via setter APIs.
 *
 * Returns { assetsReady: boolean } — everything gates on this flag.
 */

import { useEffect, useState } from 'react';

import type { SpriteData } from '../types';
import { setCharacterTemplates } from '../sprites/spriteData';
import { setFloorSprites } from '../floorTiles';
import { setWallSprites } from '../wallTiles';
import { buildDynamicCatalog } from '../layout/furnitureCatalog';

// ── Constants ────────────────────────────────────────────────

const ASSET_BASE = '/pixel-engine';
const CHAR_COUNT = 6;
const CHAR_FRAME_W = 16;
const CHAR_FRAME_H = 32;
const CHAR_FRAMES_PER_ROW = 7;
const CHARACTER_DIRECTIONS = ['down', 'up', 'right'] as const;

const PNG_ALPHA_THRESHOLD = 2;

const WALL_BITMASK_COUNT = 16;
const WALL_GRID_COLS = 4;
const WALL_PIECE_WIDTH = 16;
const WALL_PIECE_HEIGHT = 32;

const FLOOR_TILE_SIZE = 16;

// ── Pixel conversion helpers ────────────────────────────────

function rgbaToHex(r: number, g: number, b: number, a: number): string {
  if (a < PNG_ALPHA_THRESHOLD) return '';
  const hex = (v: number) => v.toString(16).padStart(2, '0');
  if (a >= 255) return `#${hex(r)}${hex(g)}${hex(b)}`.toUpperCase();
  return `#${hex(r)}${hex(g)}${hex(b)}${hex(a)}`.toUpperCase();
}

/** Load a PNG from a URL and return its ImageData */
async function loadImageData(
  url: string,
): Promise<{ imageData: ImageData; width: number; height: number }> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to fetch ${url}: ${resp.status}`);
  const blob = await resp.blob();
  const img = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  return {
    imageData: ctx.getImageData(0, 0, img.width, img.height),
    width: img.width,
    height: img.height,
  };
}

/** Convert a region of ImageData to SpriteData (2D hex array) */
function regionToSprite(
  data: Uint8ClampedArray,
  imgWidth: number,
  x0: number,
  y0: number,
  w: number,
  h: number,
): SpriteData {
  const sprite: string[][] = [];
  for (let y = 0; y < h; y++) {
    const row: string[] = [];
    for (let x = 0; x < w; x++) {
      const idx = ((y0 + y) * imgWidth + (x0 + x)) * 4;
      row.push(rgbaToHex(data[idx], data[idx + 1], data[idx + 2], data[idx + 3]));
    }
    sprite.push(row);
  }
  return sprite;
}

/** Convert full ImageData to a single SpriteData */
function imageDataToSprite(imageData: ImageData): SpriteData {
  return regionToSprite(imageData.data, imageData.width, 0, 0, imageData.width, imageData.height);
}

// ── Manifest types (mirrors assetLoader.ts) ────────────────

interface ManifestAsset {
  type: 'asset';
  id: string;
  file: string;
  width: number;
  height: number;
  footprintW: number;
  footprintH: number;
  orientation?: string;
  state?: string;
  frame?: number;
  mirrorSide?: boolean;
}

interface ManifestGroup {
  type: 'group';
  groupType: 'rotation' | 'state' | 'animation';
  rotationScheme?: string;
  orientation?: string;
  state?: string;
  members: ManifestNode[];
}

type ManifestNode = ManifestAsset | ManifestGroup;

interface FurnitureManifest {
  id: string;
  name: string;
  category: string;
  canPlaceOnWalls: boolean;
  canPlaceOnSurfaces: boolean;
  backgroundTiles: number;
  type: 'asset' | 'group';
  file?: string;
  width?: number;
  height?: number;
  footprintW?: number;
  footprintH?: number;
  groupType?: string;
  rotationScheme?: string;
  members?: ManifestNode[];
  interactable?: boolean;
  interactAction?: string;
  interactSides?: string[];
}

interface FlatAsset {
  id: string;
  label: string;
  category: string;
  file: string;
  width: number;
  height: number;
  footprintW: number;
  footprintH: number;
  isDesk: boolean;
  canPlaceOnWalls: boolean;
  canPlaceOnSurfaces: boolean;
  backgroundTiles: number;
  groupId: string;
  orientation?: string;
  state?: string;
  mirrorSide?: boolean;
  rotationScheme?: string;
  animationGroup?: string;
  frame?: number;
  interactable?: boolean;
  interactAction?: string;
  interactSides?: string[];
}

interface InheritedProps {
  groupId: string;
  name: string;
  category: string;
  canPlaceOnWalls: boolean;
  canPlaceOnSurfaces: boolean;
  backgroundTiles: number;
  orientation?: string;
  state?: string;
  rotationScheme?: string;
  animationGroup?: string;
  interactable?: boolean;
  interactAction?: string;
  interactSides?: string[];
}

/** Recursively flatten a manifest node into FlatAsset[] */
function flattenManifest(node: ManifestNode, inherited: InheritedProps): FlatAsset[] {
  if (node.type === 'asset') {
    const asset = node as ManifestAsset;
    const orientation = asset.orientation ?? inherited.orientation;
    const state = asset.state ?? inherited.state;
    return [
      {
        id: asset.id,
        label: inherited.name,
        category: inherited.category,
        file: asset.file,
        width: asset.width,
        height: asset.height,
        footprintW: asset.footprintW,
        footprintH: asset.footprintH,
        isDesk: inherited.category === 'desks',
        canPlaceOnWalls: inherited.canPlaceOnWalls,
        canPlaceOnSurfaces: inherited.canPlaceOnSurfaces,
        backgroundTiles: inherited.backgroundTiles,
        groupId: inherited.groupId,
        ...(orientation ? { orientation } : {}),
        ...(state ? { state } : {}),
        ...(asset.mirrorSide ? { mirrorSide: true } : {}),
        ...(inherited.rotationScheme ? { rotationScheme: inherited.rotationScheme } : {}),
        ...(inherited.animationGroup ? { animationGroup: inherited.animationGroup } : {}),
        ...(asset.frame !== undefined ? { frame: asset.frame } : {}),
        ...(inherited.interactable ? { interactable: true } : {}),
        ...(inherited.interactAction ? { interactAction: inherited.interactAction } : {}),
        ...(inherited.interactSides ? { interactSides: inherited.interactSides } : {}),
      },
    ];
  }

  const group = node as ManifestGroup;
  const results: FlatAsset[] = [];

  for (const member of group.members) {
    const childProps: InheritedProps = { ...inherited };

    if (group.groupType === 'rotation' && group.rotationScheme) {
      childProps.rotationScheme = group.rotationScheme;
    }

    if (group.groupType === 'state') {
      if (group.orientation) childProps.orientation = group.orientation;
      if (group.state) childProps.state = group.state;
    }

    if (group.groupType === 'animation') {
      const orient = group.orientation ?? inherited.orientation ?? '';
      const state = group.state ?? inherited.state ?? '';
      childProps.animationGroup = `${inherited.groupId}_${orient}_${state}`.toUpperCase();
      if (group.state) childProps.state = group.state;
    }

    if (group.orientation && !childProps.orientation) {
      childProps.orientation = group.orientation;
    }

    results.push(...flattenManifest(member, childProps));
  }

  return results;
}

// ── Individual loaders ──────────────────────────────────────

async function loadCharacters(): Promise<void> {
  const characters: Array<{ down: SpriteData[]; up: SpriteData[]; right: SpriteData[] }> = [];

  for (let ci = 0; ci < CHAR_COUNT; ci++) {
    const url = `${ASSET_BASE}/characters/char_${ci}.png`;
    const { imageData } = await loadImageData(url);

    const charData: { down: SpriteData[]; up: SpriteData[]; right: SpriteData[] } = {
      down: [],
      up: [],
      right: [],
    };

    for (let dirIdx = 0; dirIdx < CHARACTER_DIRECTIONS.length; dirIdx++) {
      const dir = CHARACTER_DIRECTIONS[dirIdx];
      const rowOffsetY = dirIdx * CHAR_FRAME_H;
      const frames: SpriteData[] = [];

      for (let f = 0; f < CHAR_FRAMES_PER_ROW; f++) {
        const frameOffsetX = f * CHAR_FRAME_W;
        frames.push(
          regionToSprite(
            imageData.data,
            imageData.width,
            frameOffsetX,
            rowOffsetY,
            CHAR_FRAME_W,
            CHAR_FRAME_H,
          ),
        );
      }
      charData[dir] = frames;
    }
    characters.push(charData);
  }

  console.log(`[AssetLoader] Loaded ${characters.length} character sprites`);
  setCharacterTemplates(characters);
}

async function loadFloors(): Promise<void> {
  const sprites: SpriteData[] = [];

  // Try loading floor_N.png files starting from 0
  for (let i = 0; ; i++) {
    const url = `${ASSET_BASE}/floors/floor_${i}.png`;
    try {
      const resp = await fetch(url, { method: 'HEAD' });
      if (!resp.ok) break;
      const { imageData } = await loadImageData(url);
      sprites.push(
        regionToSprite(imageData.data, imageData.width, 0, 0, FLOOR_TILE_SIZE, FLOOR_TILE_SIZE),
      );
    } catch {
      break;
    }
  }

  console.log(`[AssetLoader] Loaded ${sprites.length} floor tile patterns`);
  setFloorSprites(sprites);
}

async function loadWalls(): Promise<void> {
  const sets: SpriteData[][] = [];

  // Try loading wall_N.png files starting from 0
  for (let i = 0; ; i++) {
    const url = `${ASSET_BASE}/walls/wall_${i}.png`;
    try {
      const resp = await fetch(url, { method: 'HEAD' });
      if (!resp.ok) break;
      const { imageData } = await loadImageData(url);

      const wallSprites: SpriteData[] = [];
      for (let mask = 0; mask < WALL_BITMASK_COUNT; mask++) {
        const ox = (mask % WALL_GRID_COLS) * WALL_PIECE_WIDTH;
        const oy = Math.floor(mask / WALL_GRID_COLS) * WALL_PIECE_HEIGHT;
        wallSprites.push(
          regionToSprite(
            imageData.data,
            imageData.width,
            ox,
            oy,
            WALL_PIECE_WIDTH,
            WALL_PIECE_HEIGHT,
          ),
        );
      }
      sets.push(wallSprites);
    } catch {
      break;
    }
  }

  console.log(`[AssetLoader] Loaded ${sets.length} wall tile set(s)`);
  setWallSprites(sets);
}

async function loadFurniture(): Promise<void> {
  // Discover furniture folders by fetching a directory listing
  // In production, we fetch a pre-built manifest index.
  // For now, we fetch individual manifests from known folder names.
  const indexUrl = `${ASSET_BASE}/furniture/index.json`;
  let folderNames: string[];

  try {
    const resp = await fetch(indexUrl);
    if (resp.ok) {
      folderNames = (await resp.json()) as string[];
    } else {
      console.warn('[AssetLoader] No furniture/index.json found, skipping furniture');
      return;
    }
  } catch {
    console.warn('[AssetLoader] Failed to fetch furniture index');
    return;
  }

  const catalog: FlatAsset[] = [];
  const sprites: Record<string, SpriteData> = {};

  for (const folder of folderNames) {
    const manifestUrl = `${ASSET_BASE}/furniture/${folder}/manifest.json`;
    try {
      const resp = await fetch(manifestUrl);
      if (!resp.ok) continue;
      const manifest = (await resp.json()) as FurnitureManifest;

      const inherited: InheritedProps = {
        groupId: manifest.id,
        name: manifest.name,
        category: manifest.category,
        canPlaceOnWalls: manifest.canPlaceOnWalls,
        canPlaceOnSurfaces: manifest.canPlaceOnSurfaces,
        backgroundTiles: manifest.backgroundTiles,
        ...(manifest.interactable ? { interactable: true } : {}),
        ...(manifest.interactAction ? { interactAction: manifest.interactAction } : {}),
        ...(manifest.interactSides ? { interactSides: manifest.interactSides } : {}),
      };

      let assets: FlatAsset[];

      if (manifest.type === 'asset') {
        assets = [
          {
            id: manifest.id,
            label: manifest.name,
            category: manifest.category,
            file: manifest.file ?? `${manifest.id}.png`,
            width: manifest.width!,
            height: manifest.height!,
            footprintW: manifest.footprintW!,
            footprintH: manifest.footprintH!,
            isDesk: manifest.category === 'desks',
            canPlaceOnWalls: manifest.canPlaceOnWalls,
            canPlaceOnSurfaces: manifest.canPlaceOnSurfaces,
            backgroundTiles: manifest.backgroundTiles,
            groupId: manifest.id,
            ...(manifest.interactable ? { interactable: true } : {}),
            ...(manifest.interactAction ? { interactAction: manifest.interactAction } : {}),
            ...(manifest.interactSides ? { interactSides: manifest.interactSides } : {}),
          },
        ];
      } else {
        if (manifest.rotationScheme) {
          inherited.rotationScheme = manifest.rotationScheme;
        }
        const rootGroup: ManifestGroup = {
          type: 'group',
          groupType: manifest.groupType as 'rotation' | 'state' | 'animation',
          rotationScheme: manifest.rotationScheme,
          members: manifest.members!,
        };
        assets = flattenManifest(rootGroup, inherited);
      }

      // Load PNGs for each asset
      for (const asset of assets) {
        try {
          const assetUrl = `${ASSET_BASE}/furniture/${folder}/${asset.file}`;
          const { imageData } = await loadImageData(assetUrl);
          sprites[asset.id] = imageDataToSprite(imageData);
        } catch (err) {
          console.warn(
            `[AssetLoader] Failed to load ${asset.id}: ${err instanceof Error ? err.message : err}`,
          );
        }
      }

      catalog.push(...assets);
    } catch (err) {
      console.warn(
        `[AssetLoader] Error processing ${folder}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  console.log(`[AssetLoader] Loaded ${Object.keys(sprites).length}/${catalog.length} furniture assets`);
  buildDynamicCatalog({ catalog, sprites });
}

// ── Hook ────────────────────────────────────────────────────

export function useAssetLoader(): { assetsReady: boolean } {
  const [assetsReady, setAssetsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        // Strict load ordering: characters → floors → walls → furniture
        // This matches the extension's load order so getCatalogEntry() is ready
        // before layout is applied.
        await loadCharacters();
        if (cancelled) return;

        await loadFloors();
        if (cancelled) return;

        await loadWalls();
        if (cancelled) return;

        try {
          await loadFurniture();
        } catch (err) {
          console.error('[AssetLoader] Furniture loading failed (non-fatal):', err);
        }
        if (cancelled) return;

        console.log('[AssetLoader] All assets loaded');
        setAssetsReady(true);
      } catch (err) {
        console.error('[AssetLoader] Fatal error loading assets:', err);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  return { assetsReady };
}
