import { useState, useEffect, useCallback } from "react";
import { FolderIcon, FileTextIcon, ArrowLeftIcon, SaveIcon, Loader2Icon, PencilIcon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";
import { useFetch } from "@/lib/use-fetch";
import { useAuth } from "@/auth-context";

interface DirEntry {
  name: string;
  type: "file" | "directory";
  size: number;
  modifiedAt: string;
}

interface DirListing {
  home: string;
  path: string;
  entries: DirEntry[];
}

interface FileContent {
  path: string;
  content: string;
}

export function BotFiles({ name }: { name: string }) {
  const [currentPath, setCurrentPath] = useState("");
  const [editingFile, setEditingFile] = useState<string | null>(null);
  const [creatingFile, setCreatingFile] = useState(false);

  const url = `/bots/${encodeURIComponent(name)}/files?path=${encodeURIComponent(currentPath)}`;
  const { data, loading, error, refetch } = useFetch<DirListing>(url, { deps: [currentPath] });

  function navigateTo(entry: DirEntry) {
    if (entry.type === "directory") {
      setCurrentPath(currentPath ? `${currentPath}/${entry.name}` : entry.name);
      setEditingFile(null);
      setCreatingFile(false);
    } else if (entry.name.match(/\.(md|mdx|markdown)$/i)) {
      const filePath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
      setEditingFile(filePath);
      setCreatingFile(false);
    }
  }

  function navigateUp() {
    const parts = currentPath.split("/").filter(Boolean);
    parts.pop();
    setCurrentPath(parts.join("/"));
    setEditingFile(null);
    setCreatingFile(false);
  }

  function handleSaved() {
    setEditingFile(null);
    setCreatingFile(false);
    refetch();
  }

  if (editingFile) {
    return (
      <MarkdownEditor
        key={editingFile}
        name={name}
        filePath={editingFile}
        onBack={() => setEditingFile(null)}
        onSaved={handleSaved}
      />
    );
  }

  if (creatingFile) {
    return (
      <NewFileEditor
        name={name}
        basePath={currentPath}
        onBack={() => setCreatingFile(false)}
        onSaved={handleSaved}
      />
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        {currentPath && (
          <TooltipIconButton tooltip="Go up" variant="ghost" size="icon-xs" onClick={navigateUp}>
            <ArrowLeftIcon className="size-3" />
          </TooltipIconButton>
        )}
        <span className="text-sm font-mono text-muted-foreground truncate">
          {currentPath ? `~/${currentPath}` : "~/"}
        </span>
        <div className="flex-1" />
        <TooltipIconButton tooltip="New markdown file" variant="ghost" size="icon-sm" onClick={() => setCreatingFile(true)}>
          <PlusIcon className="size-4" />
        </TooltipIconButton>
      </div>

      {/* Content */}
      {loading && !data && (
        <div className="flex items-center justify-center p-8">
          <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {error && (
        <div className="p-4 text-sm text-destructive">{error}</div>
      )}

      {data && data.entries.length === 0 && (
        <div className="p-8 text-center text-sm text-muted-foreground">Empty directory</div>
      )}

      {data && data.entries.length > 0 && (
        <ul className="divide-y divide-border">
          {data.entries.map((entry) => {
            const isMarkdown = entry.type === "file" && /\.(md|mdx|markdown)$/i.test(entry.name);
            return (
              <li key={entry.name} className="group">
                <button
                  type="button"
                  onClick={() => navigateTo(entry)}
                  disabled={entry.type === "file" && !isMarkdown}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-accent/50 disabled:opacity-50 disabled:cursor-default"
                >
                  {entry.type === "directory" ? (
                    <FolderIcon className="size-4 text-primary shrink-0" />
                  ) : (
                    <FileTextIcon className="size-4 text-muted-foreground shrink-0" />
                  )}
                  <span className="text-sm text-foreground truncate flex-1">{entry.name}</span>
                  {isMarkdown && (
                    <PencilIcon className="size-3 text-muted-foreground sm:opacity-0 sm:group-hover:opacity-100" />
                  )}
                  {entry.type === "file" && (
                    <span className="text-xs text-muted-foreground tabular-nums">{formatSize(entry.size)}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function MarkdownEditor({ name, filePath, onBack, onSaved }: {
  name: string;
  filePath: string;
  onBack: () => void;
  onSaved: () => void;
}) {
  const { authHeaders } = useAuth();
  const url = `/bots/${encodeURIComponent(name)}/files/read?path=${encodeURIComponent(filePath)}`;
  const { data, loading, error: fetchError } = useFetch<FileContent>(url, { deps: [filePath] });

  const [content, setContent] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Reset content state when filePath changes (fix 4.1)
  useEffect(() => { setContent(null); }, [filePath]);

  const displayContent = content ?? data?.content ?? "";
  const changed = data !== null && displayContent !== data.content;

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/bots/${encodeURIComponent(name)}/files/write`, {
        method: "PUT",
        headers: { "content-type": "application/json", ...authHeaders },
        credentials: "include",
        body: JSON.stringify({ path: filePath, content: displayContent }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Failed to save" }));
        setSaveError(body.error ?? "Failed to save");
        return;
      }
      onSaved();
    } catch {
      setSaveError("Connection error");
    } finally {
      setSaving(false);
    }
  }, [name, filePath, displayContent, authHeaders, onSaved]);

  return (
    <div className="rounded-lg border border-border bg-card flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <TooltipIconButton tooltip="Back to files" variant="ghost" size="icon-xs" onClick={onBack}>
          <ArrowLeftIcon className="size-3" />
        </TooltipIconButton>
        <span className="text-sm font-mono text-muted-foreground truncate">{filePath}</span>
        <div className="flex-1" />
        <Button size="sm" disabled={!changed || saving} onClick={handleSave}>
          {saving ? <Loader2Icon className="size-4 animate-spin" /> : <SaveIcon className="size-4" />}
          Save
        </Button>
      </div>

      {/* Editor */}
      {loading && (
        <div className="flex items-center justify-center p-8">
          <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {fetchError && <div className="p-4 text-sm text-destructive">{fetchError}</div>}

      {data && (
        <textarea
          value={displayContent}
          onChange={(e) => setContent(e.target.value)}
          className="min-h-96 w-full resize-y border-0 bg-background p-4 font-mono text-sm text-foreground focus:outline-none"
          spellCheck={false}
        />
      )}

      {saveError && <div className="border-t border-border px-4 py-2 text-sm text-destructive">{saveError}</div>}
    </div>
  );
}

/** Validate filename: no path traversal segments, must end with .md extension. */
function isValidFileName(name: string): boolean {
  if (!name || !(/\.(md|mdx|markdown)$/i.test(name))) return false;
  if (name.includes("/") || name.includes("\\") || name.includes("..")) return false;
  if (name.startsWith(".")) return false;
  return true;
}

function NewFileEditor({ name, basePath, onBack, onSaved }: {
  name: string;
  basePath: string;
  onBack: () => void;
  onSaved: () => void;
}) {
  const { authHeaders } = useAuth();
  const [fileName, setFileName] = useState("");
  const [content, setContent] = useState("# ");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const fullPath = basePath ? `${basePath}/${fileName}` : fileName;
  const validName = isValidFileName(fileName);

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/bots/${encodeURIComponent(name)}/files/write`, {
        method: "PUT",
        headers: { "content-type": "application/json", ...authHeaders },
        credentials: "include",
        body: JSON.stringify({ path: fullPath, content }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Failed to create" }));
        setSaveError(body.error ?? "Failed to create");
        return;
      }
      onSaved();
    } catch {
      setSaveError("Connection error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card flex flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <TooltipIconButton tooltip="Cancel" variant="ghost" size="icon-xs" onClick={onBack}>
          <ArrowLeftIcon className="size-3" />
        </TooltipIconButton>
        <span className="text-xs text-muted-foreground">{basePath ? `${basePath}/` : ""}</span>
        <input
          type="text"
          value={fileName}
          onChange={(e) => setFileName(e.target.value)}
          placeholder="filename.md"
          className="flex-1 h-8 border-0 bg-transparent text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none"
          autoFocus
        />
        <Button size="sm" disabled={!validName || saving} onClick={handleSave}>
          {saving ? <Loader2Icon className="size-4 animate-spin" /> : <SaveIcon className="size-4" />}
          Create
        </Button>
      </div>
      {fileName && !validName && (
        <div className="px-4 py-1.5 text-xs text-warning">
          Filename must end with .md and contain no path separators
        </div>
      )}
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        className="min-h-96 w-full resize-y border-0 bg-background p-4 font-mono text-sm text-foreground focus:outline-none"
        spellCheck={false}
      />
      {saveError && <div className="border-t border-border px-4 py-2 text-sm text-destructive">{saveError}</div>}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
