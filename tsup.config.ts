import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  shims: true,
  target: "node18",
  banner: {
    js: "#!/usr/bin/env node",
  },
});