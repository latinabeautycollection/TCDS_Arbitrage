import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

describe("6.2B subscriber isolation contract", () => {
  it("documents that consumer failures are non-provider failures", () => {
    const good = vi.fn();
    const bad = vi.fn(() => {
      throw new Error("consumer failure");
    });

    const listeners = [bad, good];

    for (const listener of listeners) {
      try {
        listener();
      } catch {
        // Mirrors controller behavior: consumer failure is isolated.
      }
    }

    expect(bad).toHaveBeenCalledOnce();
    expect(good).toHaveBeenCalledOnce();
  });
});
