export const ASSETS = {
  body: "/dashboard/pixel-assets/metrocity/CharacterModel/Character Model.png",
  shadow: "/dashboard/pixel-assets/metrocity/CharacterModel/Shadow.png",
  hairs: "/dashboard/pixel-assets/metrocity/Hair/Hairs.png",
  outfit1: "/dashboard/pixel-assets/metrocity/Outfits/Outfit1.png",
  outfit2: "/dashboard/pixel-assets/metrocity/Outfits/Outfit2.png",
  outfit3: "/dashboard/pixel-assets/metrocity/Outfits/Outfit3.png",
  outfit4: "/dashboard/pixel-assets/metrocity/Outfits/Outfit4.png",
  outfit5: "/dashboard/pixel-assets/metrocity/Outfits/Outfit5.png",
  outfit6: "/dashboard/pixel-assets/metrocity/Outfits/Outfit6.png",
  suit1: "/dashboard/pixel-assets/metrocity-2.0/Suit.png",
  tileset32: "/dashboard/pixel-assets/office-tileset/Office Tileset All 32x32 no shadow.png",
  officeBackground: "/dashboard/pixel-assets/office-tileset/Office Designs/Office Level 3.png",
} as const;

export const FRAME = { width: 32, height: 32 } as const;

export const BODY_SHEET = {
  columns: 24,
  rows: 6,
  framesPerDirection: 6,
  directions: 4,
} as const;

export const HAIR_SHEET = { columns: 24, rows: 8 } as const;
export const OUTFIT_SHEET = { columns: 24, rows: 1 } as const;
export const SUIT_SHEET = { columns: 24, rows: 4 } as const;

/** Tileset spritesheet config: 16 cols × 32 rows at 32×32px */
export const TILESET_SHEET = { columns: 16, rows: 32, frameWidth: 32, frameHeight: 32 } as const;
