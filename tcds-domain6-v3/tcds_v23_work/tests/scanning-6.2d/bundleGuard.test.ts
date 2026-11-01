import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

const script = path.resolve(process.cwd(), "scripts/scandit/verify-domain6-2d-bundle.mjs");
const dirs: string[] = [];

function build(entryContents: string | null): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "domain6-2d-bundle-"));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, "dist/assets"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "dist/index.html"),
    '<script type="module" crossorigin src="/assets/index-abc.js"></script>',
  );
  if (entryContents !== null) fs.writeFileSync(path.join(dir, "dist/assets/index-abc.js"), entryContents);
  return dir;
}

function run(cwd: string): { code: number; output: string } {
  try {
    return { code: 0, output: execFileSync(process.execPath, [script], { cwd, encoding: "utf8" }) };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? 1, output: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
}

afterAll(() => { for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true }); });

describe("6.2D bundle guard", () => {
  it("passes a main bundle without the Scandit SDK", () => {
    const result = run(build('console.log("app");'));
    expect(result.code).toBe(0);
    expect(result.output).toMatch(/no Scandit SDK/);
  });

  it.each([
    'class DataCaptureView extends HTMLElement {}',
    'el.className = "scandit-container";',
    'el.setAttribute("data-scandit-default", "");',
    "new DataCaptureContext()",
    'fetch("/scandit/8.5.3/sdc-lib/x.wasm")',
  ])("fails when the main bundle contains %s", (code) => {
    const result = run(build(code));
    expect(result.code).toBe(1);
    expect(result.output).toMatch(/contains the Scandit SDK/);
  });

  it("fails closed when the entry script is missing", () => {
    const result = run(build(null));
    expect(result.code).toBe(1);
    expect(result.output).toMatch(/missing/);
  });
});
