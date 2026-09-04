import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    target: "es2022",
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Prism language plug-ins mutate the Prism singleton at module-load
          // time. Splitting every Prism module into a forced vendor chunk lets
          // Rollup evaluate a plug-in before the singleton is initialized in
          // the production build, leaving the Admin UI blank at runtime.
          // Keep Prism in Vite's normal dependency graph so its core always
          // loads before the language plug-ins.
          if (id.includes("node_modules/react") || id.includes("node_modules/react-dom") || id.includes("node_modules/react-router-dom")) {
            return "react";
          }
          return undefined;
        },
      },
    },
  },
});
