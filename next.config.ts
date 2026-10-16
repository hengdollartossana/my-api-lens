import zlib from "node:zlib";
import type { NextConfig } from "next";

// The HTTP client (undici 8) needs zstd support in Node. On older Node the app crashes later with
// "Cannot read properties of undefined (reading 'bind')", so fail early with a clear message.
if (!("createZstdDecompress" in zlib)) {
  throw new Error(
    `API Lens needs Node 24 or newer, but this is Node ${process.versions.node}. ` +
      "Run `nvm use` (the repo has an .nvmrc) or install Node 24, then start again.",
  );
}

const nextConfig: NextConfig = {};

export default nextConfig;
