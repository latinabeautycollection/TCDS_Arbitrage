import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Pack/Ship business controls (Claim, Select Box, Measurements, Seal). Owned by the TCDS dev team, not 6.2D.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/packship-controls/**/*.test.{ts,tsx}"],
  },
});
