import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Warehouse password recovery screens (employee request, new password, administrator approval). TCDS-owned PWA code.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/recovery/**/*.test.{ts,tsx}"],
  },
});
