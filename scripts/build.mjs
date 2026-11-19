import { build } from "esbuild";
await build({
  entryPoints: ["electron/main.ts"],
  outfile: "dist-electron/main.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
});
await build({
  entryPoints: ["electron/preload.ts"],
  outfile: "dist-electron/preload.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron"],
});
await build({
  entryPoints: ["electron/mcp.ts"],
  outfile: "dist-electron/mcp.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
});
