import { useState } from "react";
import { botFetch } from "../../lib/api";
import type { OfficeBridge } from "./office-bridge";

interface Props {
  bridge: OfficeBridge;
  onClose: () => void;
}

const SKIN_COLORS = ["#f5d0a9", "#e8b88a", "#c68c5c", "#a0714f", "#6b4226", "#3d2b1f"];
const HAIR_LABELS = ["Short", "Curly", "Long", "Spiky", "Bob", "Ponytail", "Mohawk", "Bald"];
const OUTFIT_OPTIONS = [
  { id: "outfit1", label: "Casual 1" },
  { id: "outfit2", label: "Casual 2" },
  { id: "outfit3", label: "Casual 3" },
  { id: "outfit4", label: "Casual 4" },
  { id: "outfit5", label: "Casual 5" },
  { id: "outfit6", label: "Casual 6" },
  { id: "suit1", label: "Suit 1" },
  { id: "suit2", label: "Suit 2" },
  { id: "suit3", label: "Suit 3" },
  { id: "suit4", label: "Suit 4" },
];

export default function CharacterEditor({ bridge, onClose }: Props) {
  const [skin, setSkin] = useState(bridge.character.skin);
  const [hair, setHair] = useState(bridge.character.hair);
  const [outfit, setOutfit] = useState(bridge.character.outfit);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await botFetch("/api/config/character", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skin, hair, outfit }),
      });
      if (res.ok) {
        bridge.character.skin = skin;
        bridge.character.hair = hair;
        bridge.character.outfit = outfit;
        bridge.revision++;
        onClose();
      }
    } catch (err) {
      console.error("Failed to save character:", err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-sm font-medium text-foreground">Character Editor</h3>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg">&times;</button>
      </div>

      <div className="mb-4">
        <label className="text-xs text-muted-foreground block mb-1">Skin</label>
        <div className="flex gap-2">
          {SKIN_COLORS.map((color, i) => (
            <button
              key={i}
              onClick={() => setSkin(i)}
              className={`w-8 h-8 rounded-md border-2 transition-colors ${skin === i ? "border-primary" : "border-transparent"}`}
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
      </div>

      <div className="mb-4">
        <label className="text-xs text-muted-foreground block mb-1">Hair</label>
        <div className="grid grid-cols-4 gap-1">
          {HAIR_LABELS.map((label, i) => (
            <button
              key={i}
              onClick={() => setHair(i)}
              className={`text-xs px-2 py-1.5 rounded-md transition-colors ${
                hair === i
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-accent"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4">
        <label className="text-xs text-muted-foreground block mb-1">Outfit</label>
        <div className="grid grid-cols-2 gap-1">
          {OUTFIT_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              onClick={() => setOutfit(opt.id)}
              className={`text-xs px-2 py-1.5 rounded-md transition-colors ${
                outfit === opt.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-accent"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50 text-sm"
      >
        {saving ? "Saving..." : "Save"}
      </button>
    </div>
  );
}
