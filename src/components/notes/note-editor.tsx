"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { toast } from "sonner";
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Quote,
  Link2,
  Code,
  Heading1,
  Heading2,
  Heading3,
  CheckSquare,
  Pin,
  Eye,
  Trash2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type NoteVM = {
  id: string;
  title: string;
  contentJson: Record<string, unknown>;
  pinned: boolean;
  visibility: "private" | "shared";
};

export function NoteEditor({
  note,
  canEditVisibility,
}: {
  note: NoteVM;
  canEditVisibility: boolean;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(note.title);
  const [pinned, setPinned] = useState(note.pinned);
  const [visibility, setVisibility] = useState<"private" | "shared">(note.visibility);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("saved");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false, HTMLAttributes: { class: "underline" } }),
      Placeholder.configure({ placeholder: "Start writing…" }),
      TaskList,
      TaskItem.configure({ nested: true }),
    ],
    content: note.contentJson,
    onUpdate: () => scheduleSave(),
    editorProps: {
      attributes: {
        class:
          "prose dark:prose-invert max-w-none focus:outline-none min-h-[40vh] text-base leading-relaxed",
      },
    },
  });

  const scheduleSave = () => {
    setStatus("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(save, 500);
  };

  const save = async () => {
    if (!editor) return;
    try {
      const json = editor.getJSON();
      const text = editor.getText();
      const res = await fetch(`/api/notes/${note.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          contentJson: json,
          contentText: text,
          pinned,
          visibility,
        }),
      });
      if (!res.ok) throw new Error();
      setStatus("saved");
    } catch {
      setStatus("idle");
      toast.error("Couldn't save. We'll try again on your next change.");
    }
  };

  useEffect(() => {
    if (title !== note.title || pinned !== note.pinned || visibility !== note.visibility) {
      scheduleSave();
    }

  }, [title, pinned, visibility]);

  const remove = async () => {
    if (!confirm("Delete this note?")) return;
    try {
      const res = await fetch(`/api/notes/${note.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      router.push("/notes");
      router.refresh();
    } catch {
      toast.error("Could not delete.");
    }
  };

  if (!editor) {
    return <div className="mx-auto max-w-3xl p-6 md:p-10 text-sm text-zinc-500">Loading…</div>;
  }

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-10">
      <div className="flex items-center justify-between gap-4 mb-3">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="text-2xl font-semibold border-0 px-0 h-auto focus-visible:ring-0 shadow-none"
          placeholder="Untitled"
        />
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-xs text-zinc-500 whitespace-nowrap mr-2">
            {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : ""}
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setPinned((p) => !p)}
            title={pinned ? "Unpin" : "Pin"}
            className={pinned ? "text-amber-500" : ""}
          >
            <Pin className="h-4 w-4" />
          </Button>
          {canEditVisibility && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setVisibility((v) => (v === "shared" ? "private" : "shared"))}
              title={visibility === "shared" ? "Make private" : "Make shared"}
              className={visibility === "private" ? "text-red-500" : ""}
            >
              <Eye className="h-4 w-4" />
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={remove} title="Delete">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {visibility === "private" && (
        <div className="text-xs text-zinc-500 mb-2">Private — only you can see this note.</div>
      )}

      <Toolbar editor={editor} />

      <EditorContent editor={editor} />
    </div>
  );
}

function Toolbar({ editor }: { editor: ReturnType<typeof useEditor> }) {
  if (!editor) return null;

  const btn = (active: boolean) =>
    cn(
      "p-1.5 rounded text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800",
      active && "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50"
    );

  const setLink = () => {
    const current = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("URL", current ?? "https://");
    if (url === null) return;
    if (url === "") editor.chain().focus().unsetLink().run();
    else editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  return (
    <div className="sticky top-0 z-10 -mx-4 mb-4 flex flex-wrap items-center gap-0.5 border-b border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-950/80 backdrop-blur px-4 py-1.5">
      <button className={btn(editor.isActive("heading", { level: 1 }))} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>
        <Heading1 className="h-4 w-4" />
      </button>
      <button className={btn(editor.isActive("heading", { level: 2 }))} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
        <Heading2 className="h-4 w-4" />
      </button>
      <button className={btn(editor.isActive("heading", { level: 3 }))} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
        <Heading3 className="h-4 w-4" />
      </button>
      <span className="mx-1 h-4 w-px bg-zinc-200 dark:bg-zinc-800" />
      <button className={btn(editor.isActive("bold"))} onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold className="h-4 w-4" />
      </button>
      <button className={btn(editor.isActive("italic"))} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic className="h-4 w-4" />
      </button>
      <button className={btn(editor.isActive("code"))} onClick={() => editor.chain().focus().toggleCode().run()}>
        <Code className="h-4 w-4" />
      </button>
      <button className={btn(editor.isActive("link"))} onClick={setLink}>
        <Link2 className="h-4 w-4" />
      </button>
      <span className="mx-1 h-4 w-px bg-zinc-200 dark:bg-zinc-800" />
      <button className={btn(editor.isActive("bulletList"))} onClick={() => editor.chain().focus().toggleBulletList().run()}>
        <List className="h-4 w-4" />
      </button>
      <button className={btn(editor.isActive("orderedList"))} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        <ListOrdered className="h-4 w-4" />
      </button>
      <button className={btn(editor.isActive("taskList"))} onClick={() => editor.chain().focus().toggleList("taskList", "taskItem").run()}>
        <CheckSquare className="h-4 w-4" />
      </button>
      <button className={btn(editor.isActive("blockquote"))} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
        <Quote className="h-4 w-4" />
      </button>
    </div>
  );
}
