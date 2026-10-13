import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["esm"],
    dts: true,
    sourcemap: true,
    clean: true,
    target: "node22",
  },
  {
    entry: { "cli/index": "src/cli/index.ts" },
    format: ["esm"],
    dts: false,
    sourcemap: true,
    clean: false,
    target: "node22",
    noExternal: [/.*/],
    banner: { js: "#!/usr/bin/env node" },
  },
]);
