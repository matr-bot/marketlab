import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import type { NextConfig } from "next";

/** The build's short commit: Vercel's, else the local checkout's, else "dev" (D-083). */
function shortSha(): string {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7);
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "dev";
  }
}

const version = (JSON.parse(readFileSync("package.json", "utf8")) as { version: string }).version;

const nextConfig: NextConfig = {
  // Shown in the landing page footer: which build this is.
  env: { NEXT_PUBLIC_APP_VERSION: version, NEXT_PUBLIC_GIT_SHA: shortSha() },
  // The terminal moved to /terminal (D-082). A run link from before (`/?scn=…&seed=…`, what LINK used
  // to copy) still opens its run: the query string is passed through to the terminal.
  async redirects() {
    return [
      { source: "/", has: [{ type: "query", key: "scn" }], destination: "/terminal", permanent: false },
      { source: "/", has: [{ type: "query", key: "seed" }], destination: "/terminal", permanent: false },
    ];
  },
};

export default nextConfig;
