"use client";

import { useRef, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { ExternalLink, FileText, Image as ImageIcon, Trash2, Upload } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type EventDocument = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  uploadedBy: string;
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function iconFor(mime: string, className = "h-4 w-4") {
  if (mime.startsWith("image/")) return <ImageIcon className={className} />;
  return <FileText className={className} />;
}

export function DocumentsSection({
  holidayId,
  legacyDocumentUrl,
  canEdit,
}: {
  holidayId: string;
  // `holidays.document_url` from the old single-doc field. Rendered as a
  // read-only row alongside new attachments so nothing disappears after
  // the migration to a multi-doc model.
  legacyDocumentUrl: string | null;
  canEdit: boolean;
}) {
  const { data, mutate } = useSWR<{ documents: EventDocument[] }>(
    `/api/holidays/${holidayId}/documents`,
    fetcher
  );
  const docs = data?.documents ?? [];
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/holidays/${holidayId}/documents`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error ?? "Upload failed");
      }
      toast.success("Attached.");
      mutate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Remove this attachment?")) return;
    mutate(
      (prev) => ({ documents: (prev?.documents ?? []).filter((d) => d.id !== id) }),
      false
    );
    try {
      const res = await fetch(`/api/holidays/${holidayId}/documents/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
    } catch {
      toast.error("Couldn't remove — refresh and try again.");
    }
    mutate();
  };

  // Nothing to render (no new docs, no legacy) and we can't upload? Hide.
  if (!canEdit && docs.length === 0 && !legacyDocumentUrl) return null;

  return (
    <Card className="mb-4">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Documents</CardTitle>
        {canEdit && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/gif,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload(f);
              }}
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="gap-1"
            >
              <Upload className="h-3.5 w-3.5" />
              {uploading ? "Uploading…" : "Attach"}
            </Button>
          </>
        )}
      </CardHeader>
      <CardContent>
        {docs.length === 0 && !legacyDocumentUrl ? (
          <p className="text-sm text-zinc-500">
            {canEdit
              ? "No documents yet. PDFs, screenshots, and photos up to 10MB."
              : "No documents."}
          </p>
        ) : (
          <ul className="space-y-2">
            {legacyDocumentUrl && (
              <li className="flex items-center justify-between gap-2 rounded-md border border-zinc-200 p-2 text-sm dark:border-zinc-800">
                <a
                  href={legacyDocumentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 min-w-0 hover:underline"
                >
                  <FileText className="h-4 w-4 shrink-0 text-zinc-500" />
                  <span className="truncate">Document</span>
                  <ExternalLink className="h-3 w-3 shrink-0 text-zinc-400" />
                </a>
              </li>
            )}
            {docs.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between gap-2 rounded-md border border-zinc-200 p-2 text-sm dark:border-zinc-800"
              >
                <a
                  href={`/api/holidays/${holidayId}/documents/${d.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 min-w-0 hover:underline"
                >
                  {iconFor(d.mimeType, "h-4 w-4 shrink-0 text-zinc-500")}
                  <span className="truncate">{d.filename}</span>
                  <span className="shrink-0 text-xs text-zinc-500">
                    · {formatBytes(d.sizeBytes)}
                  </span>
                </a>
                {canEdit && (
                  <button
                    onClick={() => remove(d.id)}
                    className="p-1 text-zinc-400 hover:text-red-500 shrink-0"
                    title="Remove"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
