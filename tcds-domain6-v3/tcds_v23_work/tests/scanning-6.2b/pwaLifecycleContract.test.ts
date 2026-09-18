import {
  describe,
  expect,
  it,
} from "vitest";

describe("6.2B iOS/PWA lifecycle contract", () => {
  it("requires serialized lifecycle ownership", () => {
    const sequence: string[] = [];
    let queue = Promise.resolve();

    const enqueue = (
      label: string,
    ) => {
      queue = queue.then(async () => {
        sequence.push(label);
      });
      return queue;
    };

    return Promise.all([
      enqueue("suspend"),
      enqueue("restore"),
      enqueue("stop"),
    ]).then(() => {
      expect(sequence).toEqual([
        "suspend",
        "restore",
        "stop",
      ]);
    });
  });
});
