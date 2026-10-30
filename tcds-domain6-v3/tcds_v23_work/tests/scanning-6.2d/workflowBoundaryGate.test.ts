import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

// The real certification script runs against a disposable repository that
// reproduces the production layout: the application is nested inside the
// repository, so Git reports changed paths with the nesting prefix.
const scriptPath = path.resolve(
  process.cwd(),
  "scripts/scandit/verify-domain6-2d-boundary.mjs",
);

const workspaces: string[] = [];

const HELPER = "src/features/receiving/services/receivingApi.ts";
const OWNED = "src/lib/scanning/workflow/contracts/WarehouseCaptureIntent.ts";

const baselineFiles: Record<string, string> = {
  [OWNED]: 'export const workflowContractVersion = "6.2D.2";\n',
  [HELPER]: "export const receivingApi = {};\n",
  // A readiness label that merely contains the word, which must never fail.
  "src/features/packShip/types/packShipTypes.ts":
    "export type PackShipReadiness = {\n  api: string;\n  postgres: string;\n};\n",
  "src/features/packShip/PackShipScreen.tsx": "export const screen = 1;\n",
  "src/lib/scanning/capture/captureStateMachine.ts": "export const capture = 1;\n",
  "src/lib/scanning/policy/capturePolicyResolver.ts": "export const policy = 1;\n",
};

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function createRepository(): { app: string; baseline: string } {
  const repository = fs.mkdtempSync(path.join(os.tmpdir(), "domain6-2d-boundary-"));
  workspaces.push(repository);

  const app = path.join(repository, "tcds-domain6-v3", "tcds_v23_work");

  git(repository, ["init", "-q"]);
  git(repository, ["config", "user.email", "certification@example.invalid"]);
  git(repository, ["config", "user.name", "Domain 6.2D certification"]);

  for (const [relativeFile, contents] of Object.entries(baselineFiles)) {
    const full = path.join(app, relativeFile);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  }

  git(repository, ["add", "."]);
  git(repository, ["commit", "-qm", "baseline"]);

  return { app, baseline: git(repository, ["rev-parse", "HEAD"]) };
}

function commit(app: string, relativeFile: string, contents: string): void {
  const full = path.join(app, relativeFile);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents);
  git(app, ["add", "."]);
  git(app, ["commit", "-qm", `change ${relativeFile}`]);
}

function runGate(
  app: string,
  baseline: string | undefined,
  head?: string,
): { code: number; output: string } {
  const env = { ...process.env } as Record<string, string>;
  if (baseline === undefined) delete env.DOMAIN6_2D_BASELINE_SHA;
  else env.DOMAIN6_2D_BASELINE_SHA = baseline;
  // The fixture repository is judged up to its own HEAD unless a test pins it.
  if (head === undefined) delete env.DOMAIN6_2D_HEAD_SHA;
  else env.DOMAIN6_2D_HEAD_SHA = head;

  try {
    return { code: 0, output: execFileSync(process.execPath, [scriptPath], {
      cwd: app, encoding: "utf8", env,
    }) };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return {
      code: failure.status ?? 1,
      output: `${failure.stdout ?? ""}${failure.stderr ?? ""}`,
    };
  }
}

afterAll(() => {
  for (const workspace of workspaces) {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

describe("6.2D database-coupling rules", () => {
  it("passes when a feature only has a property named postgres", () => {
    const { app, baseline } = createRepository();
    commit(app, OWNED, 'export const workflowContractVersion = "6.2D.2";\nexport const revision = 2;\n');

    const result = runGate(app, baseline);

    expect(result.code).toBe(0);
    expect(result.output).toMatch(/boundary verification PASSED/);
  });

  it("fails on a real pg import in a feature", () => {
    const { app, baseline } = createRepository();
    commit(app, HELPER, 'import { Pool } from "pg";\nexport const receivingApi = { Pool };\n');

    const result = runGate(app, baseline);

    expect(result.code).toBe(1);
    expect(result.output).toMatch(/database driver or query builder/);
  });

  it("fails on Supabase client use in a feature", () => {
    const { app, baseline } = createRepository();
    commit(app, HELPER, 'import { createClient } from "@supabase/supabase-js";\nexport const receivingApi = { createClient };\n');

    const result = runGate(app, baseline);

    expect(result.code).toBe(1);
    expect(result.output).toMatch(/Supabase client/);
  });

  it("fails on direct SQL execution in a feature", () => {
    const { app, baseline } = createRepository();
    commit(app, HELPER, 'export async function load(db: { query: (s: string) => Promise<unknown> }) {\n  return db.query("SELECT id FROM warehouse.receipts");\n}\n');

    const result = runGate(app, baseline);

    expect(result.code).toBe(1);
    expect(result.output).toMatch(/query through a database client|inline SQL/);
  });
});

describe("6.2D slice ownership", () => {
  it("passes when only 6.2D-owned files change", () => {
    const { app, baseline } = createRepository();
    commit(app, "src/lib/scanning/workflow/coordinator/WorkflowScanCoordinator.ts", "export const coordinator = 1;\n");

    const result = runGate(app, baseline);

    expect(result.code).toBe(0);
    expect(result.output).toMatch(/boundary verification PASSED/);
  });

  it("fails when 6.2D edits an API helper, which belongs to the backend owner", () => {
    const { app, baseline } = createRepository();
    commit(app, HELPER, "export const receivingApi = { operation: true };\n");

    const result = runGate(app, baseline);

    expect(result.code).toBe(1);
    expect(result.output).toMatch(/may not modify a Domain 6 business feature/);
  });

  it("fails when 6.2B capture implementation changes", () => {
    const { app, baseline } = createRepository();
    commit(app, "src/lib/scanning/capture/captureStateMachine.ts", "export const capture = 2;\n");

    const result = runGate(app, baseline);

    expect(result.code).toBe(1);
    expect(result.output).toMatch(/may not modify 6\.2B capture or provider implementation/);
  });

  it("fails when 6.2C policy implementation changes", () => {
    const { app, baseline } = createRepository();
    commit(app, "src/lib/scanning/policy/capturePolicyResolver.ts", "export const policy = 2;\n");

    const result = runGate(app, baseline);

    expect(result.code).toBe(1);
    expect(result.output).toMatch(/may not modify 6\.2C policy implementation/);
  });

  it("fails when a Domain 6 business feature changes", () => {
    const { app, baseline } = createRepository();
    commit(app, "src/features/packShip/PackShipScreen.tsx", "export const screen = 2;\n");

    const result = runGate(app, baseline);

    expect(result.code).toBe(1);
    expect(result.output).toMatch(/may not modify a Domain 6 business feature/);
  });

  it("does not judge later work once pinned to the 6.2D merge", () => {
    const { app, baseline } = createRepository();
    commit(app, OWNED, "export const revision = 2;\n");
    const sliceHead = git(app, ["rev-parse", "HEAD"]);
    // Screen wiring after 6.2D lands is judged by its own gate, not by 6.2D ownership.
    commit(app, "src/features/packShip/PackShipScreen.tsx", "export const screen = 2;\n");

    expect(runGate(app, baseline).code).toBe(1);
    const pinned = runGate(app, baseline, sliceHead);
    expect(pinned.code).toBe(0);
    expect(pinned.output).toMatch(/boundary verification PASSED/);
  });

  it("fails closed on a malformed head SHA", () => {
    const { app, baseline } = createRepository();
    commit(app, OWNED, "export const revision = 2;\n");

    const result = runGate(app, baseline, "not-a-sha");

    expect(result.code).toBe(1);
    expect(result.output).toMatch(/DOMAIN6_2D_HEAD_SHA must be a full 40-character SHA/);
  });

  it("fails closed when the baseline SHA is absent", () => {
    const { app } = createRepository();
    commit(app, OWNED, "export const revision = 2;\n");

    const result = runGate(app, undefined);

    expect(result.code).toBe(1);
    expect(result.output).toMatch(/must be a full 40-character SHA/);
  });
});
