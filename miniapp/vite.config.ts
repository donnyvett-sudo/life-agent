import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// VITE_BASE: path prefix when hosted under a sub-path (e.g. "/life-agent/" on GitHub Pages). Default "/".
// LIFE_DESK=1: build for embedding in a native app shell, relative paths.
export default defineConfig({
  base: process.env.LIFE_DESK ? "./" : process.env.VITE_BASE ?? "/",
  plugins: [react()],
});
