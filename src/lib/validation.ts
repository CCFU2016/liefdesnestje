import { z } from "zod";

// `z.string().url()` accepts any scheme (javascript:, file:, data:) — every
// URL we store ends up in an <a href> or a fetch, so restrict to http(s).
const HTTP_URL_RE = /^https?:\/\/\S+$/i;
const APP_URL_RE = /^\/api\/\S+$/;

export const httpUrl = z
  .string()
  .max(2000)
  .refine((u) => HTTP_URL_RE.test(u), { message: "Must be an http(s) URL" });

// Same, but also accepts links the app itself hands out for uploaded files
// (e.g. /api/uploads/recipes/<uuid>.jpg, /api/holidays/<id>/travel/document?…).
export const httpOrAppUrl = z
  .string()
  .max(2000)
  .refine((u) => HTTP_URL_RE.test(u) || APP_URL_RE.test(u), {
    message: "Must be an http(s) URL or an app-relative /api/ path",
  });
