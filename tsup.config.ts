import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  dts: false,
  splitting: false,
  // Don't bundle node_modules - let Vercel handle them
  skipNodeModulesBundle: true,
  esbuildOptions(options) {
    options.banner = {
      js: `import { createRequire } from 'module'; const require = createRequire(import.meta.url);`,
    };
  },
});
