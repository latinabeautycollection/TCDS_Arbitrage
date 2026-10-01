import {
  defineConfig,
} from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: [
      "tests/scanning-6.2c/**/*.test.ts",
      "tests/scanning-6.2c/**/*.test.tsx"
    ]
  }
});
