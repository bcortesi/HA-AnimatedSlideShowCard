import { defineConfig } from "vite";
import { resolve } from "node:path";

// Two jobs in one toolchain:
//   `npm run dev`   -> serves dev/index.html, the standalone Ken Burns tuning harness
//   `npm run build` -> bundles a single dist/animated-slideshow-card.js for HACS
export default defineConfig({
  root: ".",
  build: {
    lib: {
      entry: resolve(__dirname, "src/animated-slideshow-card.ts"),
      formats: ["es"],
      fileName: () => "animated-slideshow-card.js",
    },
    rollupOptions: {
      // Everything must be inlined: Home Assistant loads this as a single
      // resource with no module resolution of its own.
      external: [],
      output: { inlineDynamicImports: true },
    },
    outDir: "dist",
    emptyOutDir: true,
    target: "es2021",
    minify: "esbuild",
    sourcemap: false,
  },
  server: {
    open: "/dev/index.html",
  },
});
