import { fileURLToPath } from "node:url";
import tailwind from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react(), tailwind()],
  server: {
    host: "127.0.0.1",
    port: Number(process.env.WEB_PORT ?? 4320),
    strictPort: true,
    proxy: { "/api": `http://127.0.0.1:${process.env.API_PORT ?? 4321}` },
  },
  preview: {
    host: "127.0.0.1",
    port: Number(process.env.WEB_PORT ?? 4320),
    strictPort: true,
    proxy: { "/api": `http://127.0.0.1:${process.env.API_PORT ?? 4321}` },
  },
  build: { outDir: "../../dist/web", emptyOutDir: true },
});
