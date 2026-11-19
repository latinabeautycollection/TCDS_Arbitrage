import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    include: [
      "tests/packship-scanner-integration/**/*.test.{ts,tsx}",
      "tests/scanning-6.2d/packShipTwoPhysicalScans.test.ts",
      "tests/scanning-6.2d/workflowRetryContextSnapshot.test.ts",
      "tests/scanning-6.2d/packShipOperationIdentity.test.ts"
    ]
  }
});
