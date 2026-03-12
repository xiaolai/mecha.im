import type { OfficeBridge, ClickableItem } from "./office-bridge";
import { ASSETS, FRAME, BODY_SHEET, TILESET_SHEET } from "./asset-manifest";
import { TILE_SIZE, MAP_COLS, MAP_ROWS, WALKABLE } from "./tilemap-data";
import { ZONES, zoneForActivity, type ZoneId } from "./zones";
import { getRoute } from "./routes";
import { Character } from "./character";
import { SubagentCloneManager } from "./subagent-clones";
import { getWindowTint, CoffeeCounter } from "./ambient";
import { generateDecorations, type Decoration } from "./room-generator";

export class OfficeScene extends Phaser.Scene {
  private bridge!: OfficeBridge;
  private lastSeenRevision = -1;
  private character!: Character;
  private currentZone: ZoneId = "sofa";
  private cloneManager!: SubagentCloneManager;
  private coffeeCounter = new CoffeeCounter();

  private clockGraphics!: Phaser.GameObjects.Graphics;
  private windowOverlay!: Phaser.GameObjects.Rectangle;
  private clockTimer = 0;

  private clickZones: Map<ClickableItem, Phaser.GameObjects.Zone> = new Map();
  private _visibilityHandler: () => void = () => {};

  constructor() {
    super({ key: "OfficeScene" });
  }

  init(data: { bridge: OfficeBridge }): void {
    this.bridge = data.bridge;
  }

  preload(): void {
    // Loading bar
    const bar = this.add.graphics();
    this.load.on("progress", (value: number) => {
      bar.clear();
      bar.fillStyle(0x3b82f6, 1);
      bar.fillRect(100, 220, 312 * value, 16);
    });
    this.load.on("complete", () => bar.destroy());

    // Office background image (Office Level 3 — exact 512×448 match)
    this.load.image("office-bg", ASSETS.officeBackground);

    // Tileset spritesheet for decorations
    this.load.spritesheet("tileset", ASSETS.tileset32, {
      frameWidth: TILESET_SHEET.frameWidth,
      frameHeight: TILESET_SHEET.frameHeight,
    });

    // Character sprites
    this.load.spritesheet("body", ASSETS.body, {
      frameWidth: FRAME.width, frameHeight: FRAME.height,
    });
    this.load.spritesheet("hairs", ASSETS.hairs, {
      frameWidth: FRAME.width, frameHeight: FRAME.height,
    });
    this.load.spritesheet("shadow", ASSETS.shadow, {
      frameWidth: FRAME.width, frameHeight: FRAME.height,
    });

    // Outfit sheets
    for (let i = 1; i <= 6; i++) {
      const key = `outfit${i}` as keyof typeof ASSETS;
      this.load.spritesheet(`outfit${i}`, ASSETS[key], {
        frameWidth: FRAME.width, frameHeight: FRAME.height,
      });
    }

    // Suit sheet
    this.load.spritesheet("suit", ASSETS.suit1, {
      frameWidth: FRAME.width, frameHeight: FRAME.height,
    });

    // Missing asset handler
    this.load.on("loaderror", (file: { key: string }) => {
      console.warn(`[OfficeScene] Failed to load: ${file.key}`);
    });
  }

  create(): void {
    this.cameras.main.setBackgroundColor("#2a2a3e");

    // Draw the pre-rendered office background
    this.add.image(0, 0, "office-bg").setOrigin(0, 0);

    // Place random decorations from tileset
    this.placeDecorations();

    // Create character at sofa (default idle zone)
    const startZone = ZONES.sofa;
    this.character = new Character(this);
    this.character.create(
      startZone.tileX * TILE_SIZE + TILE_SIZE / 2,
      startZone.tileY * TILE_SIZE + TILE_SIZE / 2,
    );
    this.character.setFacing(startZone.facingDir);
    this.character.setConfig(this.bridge.character);

    // Character click
    this.character.getContainer().on("pointerdown", () => {
      this.bridge.onFurnitureClick?.("character");
    });

    // Subagent clones
    const deskZone = ZONES.desk;
    this.cloneManager = new SubagentCloneManager(
      this,
      deskZone.tileX * TILE_SIZE + TILE_SIZE / 2,
      deskZone.tileY * TILE_SIZE + TILE_SIZE / 2,
    );

    this.createClickZones();

    // Ambient: clock
    this.clockGraphics = this.add.graphics();
    this.drawClock();

    // Ambient: window light overlay
    this.windowOverlay = this.add.rectangle(
      MAP_COLS * TILE_SIZE / 2, 0,
      MAP_COLS * TILE_SIZE, TILE_SIZE * 2,
      0xffffff, 0,
    ).setOrigin(0.5, 0);

    // Visibility pause
    this._visibilityHandler = () => {
      if (document.hidden) {
        this.scene.pause();
      } else {
        this.scene.resume();
      }
    };
    document.addEventListener("visibilitychange", this._visibilityHandler);

    this.events.on("shutdown", () => {
      document.removeEventListener("visibilitychange", this._visibilityHandler);
    });
  }

  update(_time: number, delta: number): void {
    if (this.bridge.revision !== this.lastSeenRevision) {
      this.lastSeenRevision = this.bridge.revision;
      this.onBridgeUpdate();
    }

    this.character.update(delta);

    this.clockTimer += delta;
    if (this.clockTimer > 60_000) {
      this.clockTimer = 0;
      this.drawClock();
      this.updateWindowTint();
    }
  }

  private onBridgeUpdate(): void {
    const state = this.bridge.state;

    const targetZone = zoneForActivity(state.activity);
    if (targetZone !== this.currentZone && !this.character.isCurrentlyWalking()) {
      const prevZone = this.currentZone;
      const route = getRoute(this.currentZone, targetZone);
      this.character.walkTo(route);
      this.currentZone = targetZone;

      if (prevZone === "sofa") {
        this.coffeeCounter.onActivityChange("idle", state.activity);
      }
    }

    if (!this.character.isCurrentlyWalking()) {
      this.character.setFacing(ZONES[this.currentZone].facingDir);
    }

    this.character.setConfig(this.bridge.character);
    this.cloneManager.sync(state.subagents);
  }

  private placeDecorations(): void {
    // Derive seed from bot name (available via bridge state or fallback)
    const seed = this.bridge.state.currentSessionId ?? "default-bot";

    // Collect occupied tiles (zone positions)
    const occupied = new Set<string>();
    for (const zone of Object.values(ZONES)) {
      occupied.add(`${zone.tileX},${zone.tileY}`);
    }

    const decorations: Decoration[] = generateDecorations(WALKABLE, seed, occupied);

    for (const deco of decorations) {
      const sprite = this.add.sprite(
        deco.tileX * TILE_SIZE + TILE_SIZE / 2,
        deco.tileY * TILE_SIZE + TILE_SIZE / 2,
        "tileset",
        deco.frame,
      );
      if (deco.alpha !== undefined) sprite.setAlpha(deco.alpha);
    }
  }

  private createClickZones(): void {
    for (const [, zone] of Object.entries(ZONES) as [ZoneId, typeof ZONES[ZoneId]][]) {
      if (!zone.clickable) continue;
      const clickZone = this.add.zone(
        zone.tileX * TILE_SIZE + TILE_SIZE / 2,
        zone.tileY * TILE_SIZE + TILE_SIZE / 2,
        TILE_SIZE,
        TILE_SIZE,
      ).setInteractive();

      clickZone.on("pointerdown", () => {
        this.bridge.onFurnitureClick?.(zone.clickable!);
      });

      clickZone.on("pointerover", () => {
        this.input.setDefaultCursor("pointer");
      });
      clickZone.on("pointerout", () => {
        this.input.setDefaultCursor("default");
      });

      this.clickZones.set(zone.clickable, clickZone);
    }
  }

  private drawClock(): void {
    this.clockGraphics.clear();
    const cx = MAP_COLS * TILE_SIZE - TILE_SIZE * 2;
    const cy = TILE_SIZE / 2 + 4;
    const r = 10;

    this.clockGraphics.fillStyle(0xffffff, 0.9);
    this.clockGraphics.fillCircle(cx, cy, r);
    this.clockGraphics.lineStyle(1, 0x333333, 1);
    this.clockGraphics.strokeCircle(cx, cy, r);

    const now = new Date();
    const hourAngle = ((now.getHours() % 12) / 12) * Math.PI * 2 - Math.PI / 2;
    const minAngle = (now.getMinutes() / 60) * Math.PI * 2 - Math.PI / 2;

    this.clockGraphics.lineStyle(2, 0x333333, 1);
    this.clockGraphics.lineBetween(cx, cy, cx + Math.cos(hourAngle) * 6, cy + Math.sin(hourAngle) * 6);
    this.clockGraphics.lineStyle(1, 0x666666, 1);
    this.clockGraphics.lineBetween(cx, cy, cx + Math.cos(minAngle) * 8, cy + Math.sin(minAngle) * 8);
  }

  private updateWindowTint(): void {
    const hour = new Date().getHours();
    const tint = getWindowTint(hour);
    const color = (tint.r << 16) | (tint.g << 8) | tint.b;
    this.windowOverlay.setFillStyle(color, tint.a);
  }
}
