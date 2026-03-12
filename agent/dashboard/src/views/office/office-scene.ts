import type { OfficeBridge, ClickableItem } from "./office-bridge";
import { ASSETS, FRAME, BODY_SHEET, HAIR_SHEET, OUTFIT_SHEET, SUIT_SHEET } from "./asset-manifest";
import { TILE_SIZE, MAP_COLS, MAP_ROWS, FLOOR_LAYER } from "./tilemap-data";
import { ZONES, zoneForActivity, type ZoneId } from "./zones";
import { getRoute } from "./routes";
import { Character } from "./character";
import { SubagentCloneManager } from "./subagent-clones";
import { getWindowTint, CoffeeCounter } from "./ambient";

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

    // Tileset image
    this.load.image("tileset", ASSETS.tileset32);

    // Missing asset handler
    this.load.on("loaderror", (file: { key: string }) => {
      console.warn(`[OfficeScene] Failed to load: ${file.key}`);
    });
  }

  create(): void {
    this.cameras.main.setBackgroundColor("#2a2a3e");

    this.drawFloor();
    this.drawFurniture();

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

  private drawFloor(): void {
    const g = this.add.graphics();
    for (let row = 0; row < MAP_ROWS; row++) {
      for (let col = 0; col < MAP_COLS; col++) {
        const tile = FLOOR_LAYER[row * MAP_COLS + col];
        if (tile === -1) {
          g.fillStyle(0x4a4a5e, 1);
        } else {
          g.fillStyle(0x6b6b8a, 1);
        }
        g.fillRect(col * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      }
    }
    g.lineStyle(1, 0x555570, 0.3);
    for (let row = 0; row <= MAP_ROWS; row++) {
      g.lineBetween(0, row * TILE_SIZE, MAP_COLS * TILE_SIZE, row * TILE_SIZE);
    }
    for (let col = 0; col <= MAP_COLS; col++) {
      g.lineBetween(col * TILE_SIZE, 0, col * TILE_SIZE, MAP_ROWS * TILE_SIZE);
    }
  }

  private drawFurniture(): void {
    const g = this.add.graphics();
    const colors: Record<ZoneId, number> = {
      desk: 0x8b6914,
      phone: 0x2e7d32,
      sofa: 0x7b1fa2,
      printer: 0x1565c0,
      server: 0xc62828,
      door: 0x6d4c41,
    };

    for (const [id, zone] of Object.entries(ZONES) as [ZoneId, typeof ZONES[ZoneId]][]) {
      g.fillStyle(colors[id], 0.6);
      g.fillRect(
        zone.tileX * TILE_SIZE + 2,
        zone.tileY * TILE_SIZE + 2,
        TILE_SIZE - 4,
        TILE_SIZE - 4,
      );

      this.add.text(
        zone.tileX * TILE_SIZE + TILE_SIZE / 2,
        zone.tileY * TILE_SIZE - 6,
        zone.label,
        { fontSize: "8px", color: "#ffffff" },
      ).setOrigin(0.5, 1);
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
