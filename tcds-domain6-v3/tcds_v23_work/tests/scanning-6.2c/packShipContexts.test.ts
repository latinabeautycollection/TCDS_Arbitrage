import fs from "node:fs";
import path from "node:path";

import {
  describe,
  expect,
  it,
} from "vitest";
import {
  resolveWarehouseCapturePolicy,
} from "../../src/lib/scanning/policy/capturePolicyResolver";
import {
  DOMAIN6_2C_POLICY_REGISTRY_VERSION,
  getCapturePolicyEnvelope,
  listCapturePolicyEnvelopes,
} from "../../src/lib/scanning/policy/capturePolicyEnvelopeRegistry";
import type {
  WarehouseCaptureContextId,
} from "../../src/lib/scanning/policy/WarehouseCaptureContext";
import {
  authorityFixture,
} from "./fixtures";

const NEW_CONTEXTS: readonly WarehouseCaptureContextId[] = [
  "PACK_SOURCE",
  "PACK_OUTBOUND_LOCATION",
];

describe.each(NEW_CONTEXTS)(
  "6.2C Pack/Ship context %s",
  (contextId) => {
    it(
      "is a registered context with its own envelope",
      () => {
        const envelope =
          getCapturePolicyEnvelope(
            contextId,
          );

        expect(
          envelope.contextId,
        ).toBe(contextId);
        expect(
          listCapturePolicyEnvelopes(),
        ).toContain(envelope);
      },
    );

    it(
      "allows only Code 128 and QR, even when Warehouse Control enables more",
      () => {
        const result =
          resolveWarehouseCapturePolicy(
            contextId,
            authorityFixture(),
          );

        expect(
          result.executionPolicy
            .symbologies,
        ).toEqual([
          "CODE128",
          "QR",
        ]);
      },
    );

    it(
      "fails closed when Warehouse Control enables nothing the context allows",
      () => {
        expect(() =>
          resolveWarehouseCapturePolicy(
            contextId,
            authorityFixture({
              supportedSymbologies: [
                "EAN13_UPCA",
              ],
            }),
          ),
        ).toThrowError(
          /No effective barcode symbologies/,
        );
      },
    );

    it(
      "scans automatically unless Warehouse Control disables auto scan",
      () => {
        const automatic =
          resolveWarehouseCapturePolicy(
            contextId,
            authorityFixture(),
          );
        const restricted =
          resolveWarehouseCapturePolicy(
            contextId,
            authorityFixture({
              autoScanEnabled:
                false,
            }),
          );

        expect(
          automatic.executionPolicy
            .selection,
        ).toBe("AUTOMATIC");
        expect(
          restricted.executionPolicy
            .selection,
        ).toBe(
          "EXPLICIT_CONFIRMATION",
        );
      },
    );

    it(
      "uses the tight scan area and rejects one beyond its bounds",
      () => {
        const result =
          resolveWarehouseCapturePolicy(
            contextId,
            authorityFixture(),
          );

        expect(
          result.executionPolicy
            .scanArea,
        ).toEqual({
          widthFraction: 0.60,
          heightFraction: 0.30,
        });
        expect(() =>
          resolveWarehouseCapturePolicy(
            contextId,
            authorityFixture({
              configuration: {
                scanditWeb: {
                  scanArea: {
                    widthFraction:
                      0.95,
                    heightFraction:
                      0.30,
                  },
                },
              },
            }),
          ),
        ).toThrowError(
          /scan area exceeds/,
        );
      },
    );

    it(
      "defaults to 45 seconds and rejects a timeout beyond its bounds",
      () => {
        const result =
          resolveWarehouseCapturePolicy(
            contextId,
            authorityFixture(),
          );

        expect(
          result.captureTimeoutMs,
        ).toBe(45_000);
        expect(() =>
          resolveWarehouseCapturePolicy(
            contextId,
            authorityFixture({
              configuration: {
                scanditWeb: {
                  captureTimeoutMs:
                    180_000,
                },
              },
            }),
          ),
        ).toThrowError(
          /capture timeout exceeds/,
        );
      },
    );

    it(
      "takes duplicate filtering from Warehouse Control, not from the context",
      () => {
        const result =
          resolveWarehouseCapturePolicy(
            contextId,
            authorityFixture({
              duplicateSuppressionMs:
                1_500,
            }),
          );

        expect(
          result.executionPolicy
            .duplicateFilterSeconds,
        ).toBe(1.5);
      },
    );

    it(
      "treats feedback as a ceiling, never an instruction",
      () => {
        const allowed =
          resolveWarehouseCapturePolicy(
            contextId,
            authorityFixture(),
          );
        const silent =
          resolveWarehouseCapturePolicy(
            contextId,
            authorityFixture({
              beepEnabled: false,
              vibrationEnabled:
                false,
            }),
          );

        expect(
          allowed.executionPolicy
            .feedback,
        ).toEqual({
          sound: true,
          vibration: true,
        });
        expect(
          silent.executionPolicy
            .feedback,
        ).toEqual({
          sound: false,
          vibration: false,
        });
      },
    );

    it(
      "carries its own id and the current registry version in the lineage",
      () => {
        const result =
          resolveWarehouseCapturePolicy(
            contextId,
            authorityFixture(),
          );

        expect(
          result.executionPolicy
            .lineage,
        ).toMatchObject({
          registryVersion:
            DOMAIN6_2C_POLICY_REGISTRY_VERSION,
          profileId: contextId,
        });
      },
    );

    it(
      "gives capture guidance only, never a warehouse result",
      () => {
        expect(
          getCapturePolicyEnvelope(
            contextId,
          ).operatorHint,
        ).not.toMatch(
          /accept|reject|verif|confirm|complete|ship|stage[ds]\b/i,
        );
      },
    );
  },
);

describe(
  "6.2C registry version",
  () => {
    it(
      "is the version the policy manifest records",
      () => {
        const generator =
          fs.readFileSync(
            path.resolve(
              process.cwd(),
              "scripts/scandit/generate-domain6-2c-policy-manifest.mjs",
            ),
            "utf8",
          );

        expect(generator).toContain(
          `"${DOMAIN6_2C_POLICY_REGISTRY_VERSION}"`,
        );
      },
    );
  },
);
