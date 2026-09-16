import { defineConfig } from "vitest/config";

export default defineConfig({
  build: {
    outDir: "dist",
    target: "es2022",
    rollupOptions: {
      // Participant page is its own entry so phones skip the wheel/confetti/sound bundle.
      input: { main: "index.html", pick: "pick.html" },
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
