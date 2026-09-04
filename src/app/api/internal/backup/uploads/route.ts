import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { requireCronSecret } from "@/lib/auth/cron";
import { UPLOAD_ROOT } from "@/lib/uploads";

// Streams a gzip'd tar of the uploads volume (event documents, travel
// tickets, avatars, daily photos) to the backup cron service — see
// backup/README.md. The volume is only mounted in the app service, so this
// is the one place that can read it.
export const maxDuration = 1800;
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = requireCronSecret(req);
  if (denied) return denied;

  try {
    const st = await stat(UPLOAD_ROOT);
    if (!st.isDirectory()) throw new Error("not a directory");
  } catch {
    return NextResponse.json({ error: `Upload root ${UPLOAD_ROOT} is not available` }, { status: 404 });
  }

  // `tar` is part of every Debian/Alpine base image Railway builds with.
  // gzip level 1: these are mostly already-compressed PDFs and JPEGs.
  const child = spawn("tar", ["-cf", "-", "-C", UPLOAD_ROOT, "."], { stdio: ["ignore", "pipe", "pipe"] });
  const gzip = spawn("gzip", ["-1"], { stdio: ["pipe", "pipe", "pipe"] });
  child.stdout.pipe(gzip.stdin);

  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d.toString()));
  gzip.stderr.on("data", (d) => (stderr += d.toString()));
  const onExit = (name: string) => (code: number | null) => {
    if (code && code !== 0) console.error(`[backup] ${name} exited ${code}: ${stderr.slice(0, 500)}`);
  };
  child.on("exit", onExit("tar"));
  gzip.on("exit", onExit("gzip"));
  req.signal.addEventListener("abort", () => {
    child.kill();
    gzip.kill();
  });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return new Response(Readable.toWeb(gzip.stdout) as ReadableStream, {
    headers: {
      "content-type": "application/gzip",
      "content-disposition": `attachment; filename="uploads-${stamp}.tar.gz"`,
      "cache-control": "no-store",
    },
  });
}
