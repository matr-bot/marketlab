import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
