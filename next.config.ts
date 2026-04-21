import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@electric-sql/pglite",
    "postgres",
    "node-ical",
    "ical.js",
    "rrule",
    "moment",
    "moment-timezone",
    "axios",
  ],
};

export default nextConfig;
