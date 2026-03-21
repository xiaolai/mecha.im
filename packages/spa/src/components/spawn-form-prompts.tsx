import { Label } from "@/components/ui/label";

interface SpawnFormPromptsProps {
  systemPrompt: string;
  onSystemPromptChange: (value: string) => void;
  appendSystemPrompt: string;
  onAppendSystemPromptChange: (value: string) => void;
}

/** Renders the system prompt and append system prompt textareas for the spawn form. */
export function SpawnFormPrompts({
  systemPrompt,
  onSystemPromptChange,
  appendSystemPrompt,
  onAppendSystemPromptChange,
}: SpawnFormPromptsProps) {
  return (
    <>
      {/* System Prompt */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="spawn-system-prompt">System Prompt</Label>
        <textarea
          id="spawn-system-prompt"
          value={systemPrompt}
          onChange={(e) => onSystemPromptChange(e.target.value)}
          placeholder="You are a helpful coding assistant..."
          rows={3}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y"
        />
        <p className="text-xs text-muted-foreground">
          Overrides the default system prompt. Leave empty for default.
        </p>
      </div>

      {/* Append System Prompt */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="spawn-append-prompt">Append to System Prompt</Label>
        <textarea
          id="spawn-append-prompt"
          value={appendSystemPrompt}
          onChange={(e) => onAppendSystemPromptChange(e.target.value)}
          placeholder="Additional instructions appended to the default prompt..."
          rows={2}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y"
        />
        <p className="text-xs text-muted-foreground">
          Appends to default prompt instead of replacing it. Cannot be used with System Prompt.
        </p>
      </div>
    </>
  );
}
