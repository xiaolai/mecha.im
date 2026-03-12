import { FRAME, BODY_SHEET } from "./asset-manifest";

const DIR_MAP: Record<string, number> = {
  down: 0,
  left: 1,
  right: 2,
  up: 3,
};

export interface CharacterConfig {
  skin: number;
  hair: number;
  outfit: string;
}

export class Character {
  private scene: Phaser.Scene;
  private bodySprite!: Phaser.GameObjects.Sprite;
  private hairSprite!: Phaser.GameObjects.Sprite;
  private outfitSprite!: Phaser.GameObjects.Sprite;
  private shadowSprite!: Phaser.GameObjects.Sprite;
  private container!: Phaser.GameObjects.Container;

  private config: CharacterConfig = { skin: 0, hair: 0, outfit: "outfit1" };
  private currentDir: string = "down";
  private walkFrame = 0;
  private _isWalking = false;
  private walkPath: [number, number][] = [];
  private walkIndex = 0;
  private walkSpeed = 64; // pixels per second (2 tiles/s)
  private walkTimer = 0;
  private reducedMotion = false;

  private idleFrameTimer = 0;
  private idleFrameIndex = 0;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  create(x: number, y: number): void {
    this.shadowSprite = this.scene.add.sprite(0, 4, "shadow");
    this.bodySprite = this.scene.add.sprite(0, 0, "body");
    this.hairSprite = this.scene.add.sprite(0, 0, "hairs");
    this.outfitSprite = this.scene.add.sprite(0, 0, "outfit1");

    this.container = this.scene.add.container(x, y, [
      this.shadowSprite,
      this.bodySprite,
      this.outfitSprite,
      this.hairSprite,
    ]);
    this.container.setSize(FRAME.width, FRAME.height);
    this.container.setInteractive();

    this.updateFrame();
  }

  getContainer(): Phaser.GameObjects.Container {
    return this.container;
  }

  setConfig(config: CharacterConfig): void {
    this.config = config;
    this.updateFrame();
  }

  walkTo(path: [number, number][]): void {
    if (this.reducedMotion || path.length <= 1) {
      const dest = path[path.length - 1];
      this.container.setPosition(dest[0] * FRAME.width + FRAME.width / 2, dest[1] * FRAME.height + FRAME.height / 2);
      this._isWalking = false;
      return;
    }

    this.walkPath = path;
    this.walkIndex = 0;
    this._isWalking = true;
    this.walkTimer = 0;
  }

  update(delta: number): void {
    if (this._isWalking) {
      this.updateWalk(delta);
    } else {
      this.updateIdle(delta);
    }
  }

  isCurrentlyWalking(): boolean {
    return this._isWalking;
  }

  private updateWalk(delta: number): void {
    if (this.walkIndex >= this.walkPath.length - 1) {
      this._isWalking = false;
      this.walkFrame = 0;
      this.updateFrame();
      return;
    }

    const current = this.walkPath[this.walkIndex];
    const next = this.walkPath[this.walkIndex + 1];
    const startX = current[0] * FRAME.width + FRAME.width / 2;
    const startY = current[1] * FRAME.height + FRAME.height / 2;
    const endX = next[0] * FRAME.width + FRAME.width / 2;
    const endY = next[1] * FRAME.height + FRAME.height / 2;

    const dx = endX - startX;
    const dy = endY - startY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const duration = (dist / this.walkSpeed) * 1000;

    this.walkTimer += delta;
    const t = Math.min(this.walkTimer / duration, 1);

    this.container.setPosition(startX + dx * t, startY + dy * t);

    if (Math.abs(dx) > Math.abs(dy)) {
      this.currentDir = dx > 0 ? "right" : "left";
    } else {
      this.currentDir = dy > 0 ? "down" : "up";
    }

    this.walkFrame = Math.floor((this.walkTimer / 150) % 6);
    this.updateFrame();

    if (t >= 1) {
      this.walkIndex++;
      this.walkTimer = 0;
    }
  }

  private updateIdle(delta: number): void {
    this.idleFrameTimer += delta;
    if (this.idleFrameTimer > 500) {
      this.idleFrameTimer = 0;
      this.idleFrameIndex = this.idleFrameIndex === 0 ? 1 : 0;
      this.walkFrame = this.idleFrameIndex;
      this.updateFrame();
    }
  }

  setFacing(dir: string): void {
    this.currentDir = dir;
    this.updateFrame();
  }

  private updateFrame(): void {
    const dirIndex = DIR_MAP[this.currentDir] ?? 0;
    const frameCol = dirIndex * BODY_SHEET.framesPerDirection + this.walkFrame;

    // Body: row = skin index
    this.bodySprite.setFrame(this.config.skin * BODY_SHEET.columns + frameCol);

    // Hair: row = hair index
    this.hairSprite.setFrame(this.config.hair * BODY_SHEET.columns + frameCol);

    // Outfit: switch texture + set frame
    const outfitMatch = this.config.outfit.match(/^(outfit|suit)(\d)$/);
    if (outfitMatch) {
      if (outfitMatch[1] === "outfit") {
        this.outfitSprite.setTexture(`outfit${outfitMatch[2]}`);
        this.outfitSprite.setFrame(frameCol);
      } else {
        this.outfitSprite.setTexture("suit");
        const suitRow = parseInt(outfitMatch[2], 10) - 1;
        this.outfitSprite.setFrame(suitRow * BODY_SHEET.columns + frameCol);
      }
    }

    // Handle flipX for left direction
    const needsFlip = this.currentDir === "left";
    this.bodySprite.setFlipX(needsFlip);
    this.hairSprite.setFlipX(needsFlip);
    this.outfitSprite.setFlipX(needsFlip);
  }
}
