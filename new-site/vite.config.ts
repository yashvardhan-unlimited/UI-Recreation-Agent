import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({ root: projectRoot, plugins: [react(), tailwindcss()], server: { host: "127.0.0.1", fs: { strict: true, allow: [projectRoot] } }, preview: { host: "127.0.0.1" } });
