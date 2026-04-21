"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileText, Image as ImageIcon, Link as LinkIcon, Pencil, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { RecipeForm, type RecipeFormValue } from "./recipe-form";

type Source = "picker" | "manual" | "image" | "url" | "social" | "caption-fallback";

export function SourcePicker() {
  const router = useRouter();
  const [source, setSource] = useState<Source>("picker");
  const [extracted, setExtracted] = useState<Partial<RecipeFormValue> | null>(null);
  const [loading, setLoading] = useState(false);

  if (extracted) {
    return <RecipeForm initial={extracted} submitLabel="Save recipe" />;
  }

  if (source === "manual") {
    return <RecipeForm initial={{}} submitLabel="Create recipe" />;
  }

  return (
    <div className="mx-auto max-w-2xl p-4 md:p-10">
      <h1 className="text-2xl font-semibold mb-2">Add a recipe</h1>
      <p className="text-sm text-zinc-500 mb-6">Pick a source. You can always edit before saving.</p>

      {source === "picker" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <SourceCard
            icon={<Pencil className="h-5 w-5" />}
            title="Type it in"
            subtitle="Good for grandma&apos;s notecard"
            onClick={() => setSource("manual")}
          />
          <SourceCard
            icon={<ImageIcon className="h-5 w-5" />}
            title="Photo of a recipe"
            subtitle="Cookbook page, scrap of paper"
            onClick={() => setSource("image")}
          />
          <SourceCard
            icon={<LinkIcon className="h-5 w-5" />}
            title="From a website"
            subtitle="NYT Cooking, Serious Eats, anywhere"
            onClick={() => setSource("url")}
          />
          <SourceCard
            icon={<Sparkles className="h-5 w-5" />}
            title="TikTok / Instagram reel"
            subtitle="Paste the link"
            onClick={() => setSource("social")}
          />
        </div>
      )}

      {source === "image" && (
        <ImageUploader
          loading={loading}
          onExtract={async (file) => {
            setLoading(true);
            try {
              const fd = new FormData();
              fd.append("file", file);
              const res = await fetch("/api/recipes/extract-image", { method: "POST", body: fd });
              if (!res.ok) throw new Error((await res.json()).error ?? "Extraction failed");
              const { recipe } = await res.json();
              setExtracted(recipe);
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Extraction failed");
            } finally {
              setLoading(false);
            }
          }}
          onCancel={() => setSource("picker")}
        />
      )}

      {source === "url" && (
        <UrlExtractor
          loading={loading}
          onExtract={async (url) => {
            setLoading(true);
            try {
              const res = await fetch("/api/recipes/extract-url", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ url }),
              });
              if (!res.ok) throw new Error((await res.json()).error ?? "Extraction failed");
              const { recipe } = await res.json();
              setExtracted(recipe);
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Extraction failed");
            } finally {
              setLoading(false);
            }
          }}
          onCancel={() => setSource("picker")}
        />
      )}

      {source === "social" && (
        <SocialExtractor
          loading={loading}
          onExtract={async (url) => {
            setLoading(true);
            try {
              const res = await fetch("/api/recipes/extract-social", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ url }),
              });
              const body = await res.json();
              if (!res.ok) throw new Error(body.error ?? "Extraction failed");
              if (body.found === false) {
                toast.message(`Couldn't find a recipe in the caption${body.reason ? ` — ${body.reason}` : ""}`);
                setSource("caption-fallback");
                return;
              }
              setExtracted({ ...body.recipe, sourceUrl: url });
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Extraction failed");
            } finally {
              setLoading(false);
            }
          }}
          onCancel={() => setSource("picker")}
        />
      )}

      {source === "caption-fallback" && (
        <CaptionFallback
          loading={loading}
          onExtract={async (text) => {
            setLoading(true);
            try {
              const res = await fetch("/api/recipes/extract-url", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ rawText: text }),
              });
              if (!res.ok) throw new Error((await res.json()).error ?? "Extraction failed");
              const { recipe } = await res.json();
              setExtracted(recipe);
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Extraction failed");
            } finally {
              setLoading(false);
            }
          }}
          onCancel={() => setSource("picker")}
        />
      )}

      <div className="mt-6">
        <Button variant="ghost" size="sm" onClick={() => router.push("/meals/recipes")}>
          ← Back to recipes
        </Button>
      </div>
    </div>
  );
}

function SourceCard({
  icon,
  title,
  subtitle,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="text-left rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 hover:border-zinc-400 dark:hover:border-zinc-600 transition-colors"
    >
      <div className="flex items-center gap-2 text-zinc-500 mb-1">{icon}</div>
      <div className="font-semibold">{title}</div>
      <div className="text-xs text-zinc-500">{subtitle}</div>
    </button>
  );
}

function ImageUploader({
  loading,
  onExtract,
  onCancel,
}: {
  loading: boolean;
  onExtract: (f: File) => void;
  onCancel: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload a photo</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <input
          type="file"
          accept="image/*"
          disabled={loading}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onExtract(f);
          }}
          className="block w-full text-sm"
        />
        <p className="text-xs text-zinc-500">
          Clear, straight-on shots of a single page work best. Max 10MB.
        </p>
        {loading && <p className="text-sm text-zinc-500">Reading the recipe…</p>}
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={loading}>Cancel</Button>
      </CardContent>
    </Card>
  );
}

function UrlExtractor({
  loading,
  onExtract,
  onCancel,
}: {
  loading: boolean;
  onExtract: (url: string) => void;
  onCancel: () => void;
}) {
  const [url, setUrl] = useState("");
  return (
    <Card>
      <CardHeader>
        <CardTitle>Paste a recipe URL</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.nytimes.com/cooking/…"
          disabled={loading}
        />
        <p className="text-xs text-zinc-500">Most major recipe sites work — we prefer structured data when available.</p>
        <div className="flex gap-2">
          <Button onClick={() => url && onExtract(url.trim())} disabled={!url.trim() || loading}>
            {loading ? "Fetching…" : "Extract"}
          </Button>
          <Button variant="ghost" onClick={onCancel} disabled={loading}>Cancel</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SocialExtractor({
  loading,
  onExtract,
  onCancel,
}: {
  loading: boolean;
  onExtract: (url: string) => void;
  onCancel: () => void;
}) {
  const [url, setUrl] = useState("");
  return (
    <Card>
      <CardHeader>
        <CardTitle>TikTok or Instagram reel</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.tiktok.com/@…  or  https://www.instagram.com/reel/…"
          disabled={loading}
        />
        <p className="text-xs text-zinc-500 flex items-start gap-1.5">
          <FileText className="h-3 w-3 mt-0.5 shrink-0" />
          We read the caption to extract the recipe. If it&apos;s just &quot;yum 😍&quot;, we&apos;ll ask you to paste the recipe text.
        </p>
        <div className="flex gap-2">
          <Button onClick={() => url && onExtract(url.trim())} disabled={!url.trim() || loading}>
            {loading ? "Fetching…" : "Extract"}
          </Button>
          <Button variant="ghost" onClick={onCancel} disabled={loading}>Cancel</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function CaptionFallback({
  loading,
  onExtract,
  onCancel,
}: {
  loading: boolean;
  onExtract: (t: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  return (
    <Card>
      <CardHeader>
        <CardTitle>Paste the recipe text</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <textarea
          className="w-full min-h-[160px] rounded-md border border-zinc-200 bg-transparent px-3 py-2 text-sm dark:border-zinc-800"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Copy the full caption or ingredient list + steps here…"
          disabled={loading}
        />
        <div className="flex gap-2">
          <Button onClick={() => text && onExtract(text.trim())} disabled={!text.trim() || loading}>
            {loading ? "Reading…" : "Extract"}
          </Button>
          <Button variant="ghost" onClick={onCancel} disabled={loading}>Cancel</Button>
        </div>
      </CardContent>
    </Card>
  );
}
