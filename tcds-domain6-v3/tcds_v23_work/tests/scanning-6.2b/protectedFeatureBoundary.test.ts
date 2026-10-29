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

// The real certification script is executed against a disposable repository that
// reproduces the production layout: the application is nested inside the
// repository, so Git reports changed paths with the nesting prefix.
const scriptPath =
  path.resolve(
    process.cwd(),
    "scripts/scandit/verify-domain6-2b-boundary.mjs",
  );

const workspaces: string[] = [];

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
        "domain6-2b-boundary-",
      ),
    );

  workspaces.push(repository);

  const app = path.join(
    repository,
    "tcds-domain6-v3",
    "tcds_v23_work",
  );

  fs.mkdirSync(
    path.join(
      app,
      "src/lib/scanning/capture",
    ),
    { recursive: true },
  );

  fs.mkdirSync(
    path.join(
      app,
      "src/features/receiving",
    ),
    { recursive: true },
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
    "Domain 6.2B certification",
  ]);

  fs.writeFileSync(
    path.join(
      app,
      "src/lib/scanning/capture/capturePolicy.ts",
    ),
    "export const captureRevision = 1;\n",
  );

  fs.writeFileSync(
    path.join(
      app,
      "src/features/receiving/ReceivingWorkflow.ts",
    ),
    "export const receivingRevision = 1;\n",
  );

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
  contents: string,
): void {
  fs.writeFileSync(
    path.join(app, relativeFile),
    contents,
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
  baseline: string,
  head?: string,
): { code: number; output: string } {
  const env = {
    ...process.env,
    DOMAIN6_2B_BASELINE_SHA:
      baseline,
  } as Record<string, string>;

  // Unless a test pins it, the fixture repository is judged up to its own HEAD.
  if (head === undefined) {
    delete env.DOMAIN6_2B_HEAD_SHA;
  } else {
    env.DOMAIN6_2B_HEAD_SHA = head;
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

describe("6.2B protected warehouse-feature boundary", () => {
  it("passes when only scanner-owned files change", () => {
    const { app, baseline } =
      createRepository();

    commit(
      app,
      "src/lib/scanning/capture/capturePolicy.ts",
      "export const captureRevision = 2;\n",
    );

    const result =
      runBoundaryCheck(
        app,
        baseline,
      );

    expect(result.code).toBe(0);
    expect(result.output).toMatch(
      /boundary verification PASSED/,
    );
  });

  it("fails when a protected warehouse feature changes", () => {
    const { app, baseline } =
      createRepository();

    commit(
      app,
      "src/features/receiving/ReceivingWorkflow.ts",
      "export const receivingRevision = 2;\n",
    );

    const result =
      runBoundaryCheck(
        app,
        baseline,
      );

    expect(result.code).toBe(1);
    expect(result.output).toMatch(
      /may not modify a Domain 6 business feature/,
    );
  });

  it("judges only the pinned 6.2B range when a head SHA is set", () => {
    const { app, baseline } =
      createRepository();

    commit(
      app,
      "src/lib/scanning/capture/capturePolicy.ts",
      "export const captureRevision = 2;\n",
    );

    const sliceHead = git(app, [
      "rev-parse",
      "HEAD",
    ]);

    // Later screen wiring touches a protected feature after the slice merged.
    commit(
      app,
      "src/features/receiving/ReceivingWorkflow.ts",
      "export const receivingRevision = 2;\n",
    );

    const pinned =
      runBoundaryCheck(
        app,
        baseline,
        sliceHead,
      );

    expect(pinned.code).toBe(0);
    expect(pinned.output).toMatch(
      /boundary verification PASSED/,
    );
  });

  it("fails closed when the head SHA is not a full SHA", () => {
    const { app, baseline } =
      createRepository();

    commit(
      app,
      "src/lib/scanning/capture/capturePolicy.ts",
      "export const captureRevision = 2;\n",
    );

    const result =
      runBoundaryCheck(
        app,
        baseline,
        "main",
      );

    expect(result.code).toBe(1);
    expect(result.output).toMatch(
      /DOMAIN6_2B_HEAD_SHA must be a full 40-character Git SHA/,
    );
  });
});
