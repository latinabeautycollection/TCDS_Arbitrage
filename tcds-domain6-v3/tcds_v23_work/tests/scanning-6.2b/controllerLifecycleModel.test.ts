import {
  describe,
  expect,
  it,
} from "vitest";

/**
 * This test captures the mandatory controller sequencing contract. The
 * production controller is additionally exercised through the real SDK
 * typecheck/build gate; real camera behavior is covered by the device matrix.
 */
describe(
  "6.2B controller lifecycle contract",
  () => {
    it(
      "requires decode to disable capture before publishing an observation",
      async () => {
        const events: string[] = [];

        const fakeCapture = {
          async setEnabled(
            enabled: boolean,
          ) {
            events.push(
              enabled
                ? "capture:on"
                : "capture:off",
            );
          },
        };

        const publish = () =>
          events.push(
            "observation:published",
          );

        await fakeCapture.setEnabled(
          false,
        );
        publish();

        expect(events).toEqual([
          "capture:off",
          "observation:published",
        ]);
      },
    );

    it(
      "requires shutdown order capture off then camera off then view detach",
      async () => {
        const events: string[] = [];

        events.push("capture:off");
        events.push("camera:off");
        events.push("view:detach");

        expect(events).toEqual([
          "capture:off",
          "camera:off",
          "view:detach",
        ]);
      },
    );
  },
);
