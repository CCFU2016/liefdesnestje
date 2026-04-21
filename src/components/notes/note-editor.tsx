"use client";

// Basic Tiptap editor with autosave. Sprint 4 will add: pinned UI, visibility
// toggle, search, keyboard shortcuts, checkboxes, richer toolbar.

import { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";

type NoteVM = {
  id: string;
  title: string;
  contentJson: Record<string, unknown>;
  pinned: boolean;
  visibility: "private" | "shared";
};

export function NoteEditor({
  note,
  canEditVisibility: _canEditVisibility,
}: {
  note: NoteVM;
  canEditVisibility: boolean;
}) {
  const [title, setTitle] = useState(note.title);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("saved");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false, HTMLAttributes: { class: "underline" } }),
      Placeholder.configure({ placeholder: "Start writing…" }),
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
        body: JSON.stringify({ title, contentJson: json, contentText: text }),
      });
      if (!res.ok) throw new Error();
      setStatus("saved");
    } catch {
      setStatus("idle");
      toast.error("Couldn't save. We'll try again on your next change.");
    }
  };

  useEffect(() => {
    if (title !== note.title) scheduleSave();

  }, [title]);

  return (
    <div className="mx-auto max-w-3xl p-6 md:p-10">
      <div className="flex items-center justify-between mb-4">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="text-2xl font-semibold border-0 px-0 h-auto focus-visible:ring-0 shadow-none"
          placeholder="Untitled"
        />
        <span className="text-xs text-zinc-500 whitespace-nowrap ml-4">
          {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : ""}
        </span>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
