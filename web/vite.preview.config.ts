import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const webRoot = fileURLToPath(new URL("./", import.meta.url));
const previewRoot = fileURLToPath(new URL("./preview/", import.meta.url));
const previewOut = fileURLToPath(new URL("./preview-dist/", import.meta.url));

export default defineConfig({
  root: previewRoot,
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
