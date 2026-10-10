import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss()],
  build: {
    manifest: true,
    // motion and R3F ship "use client" directives that mean nothing in a client-only bundle; the noise would bury real build errors.
    rolldownOptions: { onwarn: (w, warn) => w.code !== "MODULE_LEVEL_DIRECTIVE" && warn(w) },
  },
});
