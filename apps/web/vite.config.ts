import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The NestJS API listens on port 3001 (see apps/api/src/main.ts: `PORT ?? 3001`)
// and mounts every query under `POST /api/query/:name`. In dev we proxy the
// whole `/api` prefix through to it so the browser talks to the Vite origin
// only (no CORS), and the app can call `fetch("/api/query/...")` unchanged in
// both dev and a same-origin production deployment.
const API_TARGET = process.env.VITE_API_TARGET ?? "http://localhost:3001";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: API_TARGET,
        changeOrigin: true,
      },
    },
  },
});
