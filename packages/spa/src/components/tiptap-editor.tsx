import { useEffect, useRef, useCallback } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";
import DOMPurify from "dompurify";
import {
  BoldIcon, ItalicIcon, StrikethroughIcon, CodeIcon,
  Heading1Icon, Heading2Icon, Heading3Icon,
  ListIcon, ListOrderedIcon, QuoteIcon, CodeSquareIcon,
  MinusIcon, Undo2Icon, Redo2Icon,
} from "lucide-react";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";
import { cn } from "@/lib/utils";

interface TiptapEditorProps {
  initialContent: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
}

/** Renders a rich-text editor powered by Tiptap with markdown support and mermaid rendering. */
export function TiptapEditor({ initialContent, onChange, placeholder }: TiptapEditorProps) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const editor = useEditor({
    extensions: [
      StarterKit,
      Markdown,
      Placeholder.configure({ placeholder: placeholder ?? "Start writing..." }),
    ],
    content: initialContent,
    immediatelyRender: false,
    onUpdate: ({ editor: e }) => {
      const md = (e.storage as Record<string, any>).markdown.getMarkdown() as string;
      onChangeRef.current(md);
    },
  });

  // Render mermaid diagrams in code blocks
  useMermaidRenderer(editor ?? null);

  if (!editor) return null;

  return (
    <div className="flex flex-col">
      <EditorToolbar editor={editor} />
      <EditorContent
        editor={editor}
        className="tiptap-editor min-h-96 w-full bg-background p-4 text-sm text-foreground focus-within:outline-none [&_.tiptap]:outline-none [&_.tiptap]:min-h-80"
      />
    </div>
  );
}

function EditorToolbar({ editor }: { editor: ReturnType<typeof useEditor> }) {
  if (!editor) return null;

  const btn = (tooltip: string, action: () => void, active: boolean, icon: React.ReactNode) => (
    <TooltipIconButton
      tooltip={tooltip}
      variant="ghost"
      size="icon-xs"
      className={cn(active && "bg-accent text-accent-foreground")}
      onClick={action}
    >
      {icon}
    </TooltipIconButton>
  );

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-border px-3 py-1.5">
      {btn("Bold", () => editor.chain().focus().toggleBold().run(), editor.isActive("bold"), <BoldIcon className="size-3.5" />)}
      {btn("Italic", () => editor.chain().focus().toggleItalic().run(), editor.isActive("italic"), <ItalicIcon className="size-3.5" />)}
      {btn("Strikethrough", () => editor.chain().focus().toggleStrike().run(), editor.isActive("strike"), <StrikethroughIcon className="size-3.5" />)}
      {btn("Inline code", () => editor.chain().focus().toggleCode().run(), editor.isActive("code"), <CodeIcon className="size-3.5" />)}

      <Separator />

      {btn("Heading 1", () => editor.chain().focus().toggleHeading({ level: 1 }).run(), editor.isActive("heading", { level: 1 }), <Heading1Icon className="size-3.5" />)}
      {btn("Heading 2", () => editor.chain().focus().toggleHeading({ level: 2 }).run(), editor.isActive("heading", { level: 2 }), <Heading2Icon className="size-3.5" />)}
      {btn("Heading 3", () => editor.chain().focus().toggleHeading({ level: 3 }).run(), editor.isActive("heading", { level: 3 }), <Heading3Icon className="size-3.5" />)}

      <Separator />

      {btn("Bullet list", () => editor.chain().focus().toggleBulletList().run(), editor.isActive("bulletList"), <ListIcon className="size-3.5" />)}
      {btn("Ordered list", () => editor.chain().focus().toggleOrderedList().run(), editor.isActive("orderedList"), <ListOrderedIcon className="size-3.5" />)}
      {btn("Blockquote", () => editor.chain().focus().toggleBlockquote().run(), editor.isActive("blockquote"), <QuoteIcon className="size-3.5" />)}
      {btn("Code block", () => editor.chain().focus().toggleCodeBlock().run(), editor.isActive("codeBlock"), <CodeSquareIcon className="size-3.5" />)}
      {btn("Horizontal rule", () => editor.chain().focus().setHorizontalRule().run(), false, <MinusIcon className="size-3.5" />)}

      <Separator />

      {btn("Undo", () => editor.chain().focus().undo().run(), false, <Undo2Icon className="size-3.5" />)}
      {btn("Redo", () => editor.chain().focus().redo().run(), false, <Redo2Icon className="size-3.5" />)}
    </div>
  );
}

function Separator() {
  return <div className="mx-1 h-5 w-px bg-border" />;
}

const MERMAID_RE = /^\s*(graph |flowchart |sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|gitGraph|journey|mindmap|timeline|quadrantChart|sankey|xychart)/m;

/** Renders mermaid code blocks as sanitized SVG diagrams below the code. */
function useMermaidRenderer(editor: ReturnType<typeof useEditor> | null) {
  const renderMermaid = useCallback(async () => {
    if (!editor) return;
    const el = editor.view.dom;
    const codeBlocks = el.querySelectorAll("pre > code");
    const mermaid = (await import("mermaid")).default;
    mermaid.initialize({ startOnLoad: false, theme: "dark" });

    for (const code of codeBlocks) {
      const pre = code.parentElement;
      if (!pre) continue;
      const text = code.textContent ?? "";
      if (!MERMAID_RE.test(text)) continue;
      if (pre.nextElementSibling?.classList.contains("mermaid-preview")) continue;
      try {
        const id = `mermaid-${Math.random().toString(36).slice(2, 8)}`;
        const { svg } = await mermaid.render(id, text);
        const sanitized = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } });
        const wrapper = document.createElement("div");
        wrapper.className = "mermaid-preview rounded-md border border-border bg-card p-3 my-2 overflow-x-auto";
        wrapper.textContent = "";
        wrapper.insertAdjacentHTML("afterbegin", sanitized);
        pre.insertAdjacentElement("afterend", wrapper);
      } catch {
        // Invalid mermaid syntax — skip silently
      }
    }
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    let debounceTimer: ReturnType<typeof setTimeout>;
    const timer = setTimeout(renderMermaid, 300);
    const onUpdate = () => {
      const parent = editor.view.dom.parentElement;
      parent?.querySelectorAll(".mermaid-preview").forEach((el) => el.remove());
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(renderMermaid, 500);
    };
    editor.on("update", onUpdate);
    return () => {
      clearTimeout(timer);
      clearTimeout(debounceTimer);
      editor.off("update", onUpdate);
    };
  }, [editor, renderMermaid]);
}
