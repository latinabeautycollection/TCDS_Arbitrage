import {
  execFileSync,
} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  afterAll,
  describe,
  expect,
  it,
} from "vitest";

// The real certification script is executed against a disposable repository
// that reproduces the production layout: the application is nested inside the
// repository, so Git reports changed paths with the nesting prefix.
const scriptPath =
  path.resolve(
    process.cwd(),
    "scripts/scandit/verify-domain6-2c-boundary.mjs",
  );

const workspaces: string[] = [];

const baselineFiles: Record<string, string> = {
  "src/lib/scanning/policy/capturePolicyResolver.ts":
    "export const policyRevision = 1;\n",
  "src/lib/scanning/capture/captureStateMachine.ts":
    "export const captureRevision = 1;\n",
  "src/lib/scanning/providers/scandit/ScanditBarcodeCaptureController.ts":
    "export const controllerRevision = 1;\n",
  "src/features/receiving/ReceivingWorkflow.ts":
    "export const receivingRevision = 1;\n",
  "src/pages/diagnostics/ScannerCaptureDiagnosticPage.tsx":
    "export const diagnosticRevision = 1;\n",
};

function git(
  cwd: string,
  args: string[],
): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function createRepository(): {
  app: string;
  baseline: string;
} {
  const repository =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "domain6-2c-boundary-",
      ),
    );

  workspaces.push(repository);

  const app = path.join(
    repository,
    "tcds-domain6-v3",
    "tcds_v23_work",
  );

  git(repository, ["init", "-q"]);
  git(repository, [
    "config",
    "user.email",
    "certification@example.invalid",
  ]);
  git(repository, [
    "config",
    "user.name",
    "Domain 6.2C certification",
  ]);

  for (
    const [
      relativeFile,
      contents,
    ] of Object.entries(
      baselineFiles,
    )
  ) {
    const full =
      path.join(app, relativeFile);

    fs.mkdirSync(
      path.dirname(full),
      { recursive: true },
    );

    fs.writeFileSync(full, contents);
  }

  git(repository, ["add", "."]);
  git(repository, [
    "commit",
    "-qm",
    "baseline",
  ]);

  return {
    app,
    baseline: git(repository, [
      "rev-parse",
      "HEAD",
    ]),
  };
}

function commit(
  app: string,
  relativeFile: string,
): void {
  const full =
    path.join(app, relativeFile);

  fs.mkdirSync(
    path.dirname(full),
    { recursive: true },
  );

  fs.writeFileSync(
    full,
    "export const revision = 2;\n",
  );

  git(app, ["add", "."]);
  git(app, [
    "commit",
    "-qm",
    `change ${relativeFile}`,
  ]);
}

function runBoundaryCheck(
  app: string,
  baseline: string | undefined,
): { code: number; output: string } {
  const env = {
    ...process.env,
  } as Record<string, string>;

  if (baseline === undefined) {
    delete env.DOMAIN6_2C_BASELINE_SHA;
  } else {
    env.DOMAIN6_2C_BASELINE_SHA =
      baseline;
  }

  try {
    const stdout = execFileSync(
      process.execPath,
      [scriptPath],
      {
        cwd: app,
        encoding: "utf8",
        env,
      },
    );

    return {
      code: 0,
      output: stdout,
    };
  } catch (error) {
    const failure = error as {
      status?: number;
      stdout?: string;
      stderr?: string;
    };

    return {
      code: failure.status ?? 1,
      output: `${failure.stdout ?? ""}${failure.stderr ?? ""}`,
    };
  }
}

afterAll(() => {
  for (const workspace of workspaces) {
    fs.rmSync(workspace, {
      recursive: true,
      force: true,
    });
  }
});

describe("6.2C policy ownership boundary", () => {
  it("passes when only 6.2C policy files change", () => {
    const { app, baseline } =
      createRepository();

    commit(
      app,
      "src/lib/scanning/policy/capturePolicyResolver.ts",
    );

    const result =
      runBoundaryCheck(app, baseline);

    expect(result.code).toBe(0);
    expect(result.output).toMatch(
      /boundary verification PASSED/,
    );
  });

  it("fails when a 6.2B capture implementation file changes", () => {
    const { app, baseline } =
      createRepository();

    commit(
      app,
      "src/lib/scanning/capture/captureStateMachine.ts",
    );

    const result =
      runBoundaryCheck(app, baseline);

    expect(result.code).toBe(1);
    expect(result.output).toMatch(
      /may not modify 6\.2B implementation or a Domain 6 business feature/,
    );
  });

  it("fails when a 6.2B Scandit provider file changes", () => {
    const { app, baseline } =
      createRepository();

    commit(
      app,
      "src/lib/scanning/providers/scandit/ScanditBarcodeCaptureController.ts",
    );

    const result =
      runBoundaryCheck(app, baseline);

    expect(result.code).toBe(1);
    expect(result.output).toMatch(
      /may not modify 6\.2B implementation or a Domain 6 business feature/,
    );
  });

  it("fails when a protected Domain 6 business feature changes", () => {
    const { app, baseline } =
      createRepository();

    commit(
      app,
      "src/features/receiving/ReceivingWorkflow.ts",
    );

    const result =
      runBoundaryCheck(app, baseline);

    expect(result.code).toBe(1);
    expect(result.output).toMatch(
      /may not modify 6\.2B implementation or a Domain 6 business feature/,
    );
  });

  it("fails when a source file outside the 6.2C allowlist changes", () => {
    const { app, baseline } =
      createRepository();

    commit(
      app,
      "src/pages/diagnostics/ScannerCaptureDiagnosticPage.tsx",
    );

    const result =
      runBoundaryCheck(app, baseline);

    expect(result.code).toBe(1);
    expect(result.output).toMatch(
      /source change is outside the 6\.2C allowlist/,
    );
  });

  it("fails closed when the baseline SHA is absent", () => {
    const { app } =
      createRepository();

    commit(
      app,
      "src/lib/scanning/policy/capturePolicyResolver.ts",
    );

    const result =
      runBoundaryCheck(app, undefined);

    expect(result.code).toBe(1);
    expect(result.output).toMatch(
      /must be a full 40-character SHA/,
    );
  });
});
