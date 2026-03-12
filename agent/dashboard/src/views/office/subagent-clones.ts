const MAX_VISIBLE = 5;
const CLONE_ALPHA = 0.5;
const FADE_DURATION = 500;
const OFFSET_PX = 16;

interface CloneEntry {
  id: string;
  type: string;
  description: string;
  sprite: Phaser.GameObjects.Sprite;
  label: Phaser.GameObjects.Text;
}

export class SubagentCloneManager {
  private scene: Phaser.Scene;
  private clones: CloneEntry[] = [];
  private baseX: number;
  private baseY: number;

  constructor(scene: Phaser.Scene, baseX: number, baseY: number) {
    this.scene = scene;
    this.baseX = baseX;
    this.baseY = baseY;
  }

  spawn(id: string, type: string, description: string): void {
    if (this.clones.length >= MAX_VISIBLE) return;

    const offsetIndex = this.clones.length;
    const x = this.baseX + (offsetIndex + 1) * OFFSET_PX;
    const y = this.baseY;

    const sprite = this.scene.add.sprite(x, y, "body");
    sprite.setAlpha(0);
    sprite.setFrame(0);

    const label = this.scene.add.text(x, y - 20, type, {
      fontSize: "8px",
      color: "#ffffff",
      backgroundColor: "#00000080",
      padding: { x: 2, y: 1 },
    });
    label.setOrigin(0.5);
    label.setAlpha(0);

    this.scene.tweens.add({ targets: [sprite, label], alpha: CLONE_ALPHA, duration: FADE_DURATION });

    this.clones.push({ id, type, description, sprite, label });
  }

  despawn(id: string): void {
    const index = this.clones.findIndex((c) => c.id === id);
    if (index === -1) return;

    const clone = this.clones[index];
    this.scene.tweens.add({
      targets: [clone.sprite, clone.label],
      alpha: 0,
      duration: FADE_DURATION,
      onComplete: () => {
        clone.sprite.destroy();
        clone.label.destroy();
      },
    });

    this.clones.splice(index, 1);
  }

  sync(subagents: { id: string; type: string; description: string }[]): void {
    const currentIds = new Set(this.clones.map((c) => c.id));
    const newIds = new Set(subagents.map((s) => s.id));

    for (const clone of [...this.clones]) {
      if (!newIds.has(clone.id)) this.despawn(clone.id);
    }

    for (const s of subagents) {
      if (!currentIds.has(s.id)) this.spawn(s.id, s.type, s.description);
    }
  }

  destroy(): void {
    for (const clone of this.clones) {
      clone.sprite.destroy();
      clone.label.destroy();
    }
    this.clones = [];
  }
}
