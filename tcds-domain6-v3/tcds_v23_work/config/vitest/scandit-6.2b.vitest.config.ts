import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    include: [
      "tests/scanning-6.2b/**/*.test.{ts,tsx}",
    ],
    setupFiles: [],
  },
});
