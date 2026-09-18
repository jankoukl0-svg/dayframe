import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const webRoot = fileURLToPath(new URL("./", import.meta.url));
const previewRoot = fileURLToPath(new URL("./preview/", import.meta.url));
const previewOut = fileURLToPath(new URL("./preview-dist/", import.meta.url));

export default defineConfig({
  root: previewRoot,
  // Relative assets work at both Vercel / and GitHub Pages /dayframe/.
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      "@": webRoot,
    },
  },
  build: {
    outDir: previewOut,
    emptyOutDir: true,
  },
});
