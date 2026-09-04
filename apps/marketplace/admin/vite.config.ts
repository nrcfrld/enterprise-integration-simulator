import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const adminCoverageMinimum = Number.parseFloat(
  process.env.ADMIN_COVERAGE_MIN ?? "60",
);

const config = {
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
        manualChunks(id: string) {
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
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "istanbul" as const,
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/**/*.d.ts",
        "src/test/**",
        "src/shared/types/**",
        "src/features/developer-portal/types.ts",
      ],
      thresholds: {
        statements: adminCoverageMinimum,
        branches: adminCoverageMinimum,
        functions: adminCoverageMinimum,
        lines: adminCoverageMinimum,
      },
    },
  },
};

export default defineConfig(config);
