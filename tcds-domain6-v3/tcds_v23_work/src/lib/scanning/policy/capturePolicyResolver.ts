import type {
  BarcodeCaptureExecutionPolicy,
} from "../capture/BarcodeCaptureCapability";
import type {
  WarehouseSymbology,
} from "../capture/WarehouseSymbology";
import {
  getCapturePolicyEnvelope,
  DOMAIN6_2C_POLICY_REGISTRY_VERSION,
} from "./capturePolicyEnvelopeRegistry";
import type {
  WarehouseCaptureContextId,
} from "./WarehouseCaptureContext";
import type {
  WarehouseControlCaptureAuthoritySnapshot,
} from "./WarehouseControlCaptureSnapshot";
import type {
  ResolvedWarehouseCapturePolicy,
  CapturePolicyWarning,
} from "./CapturePolicyResolution";
import {
  CapturePolicyError,
} from "./CapturePolicyError";
import {
  mapWarehouseControlSymbology,
} from "./warehouseControlSymbologyMapper";
import {
  readScanditWebConfigurationExtension,
} from "./configurationExtension";
import {
  resolveSelection,
  validateAuthoritySnapshot,
  validateCaptureTimeout,
  validateScanArea,
} from "./capturePolicyValidator";

function normalizedCode(
  value: string,
): string {
  return value
    .trim()
    .toUpperCase()
    .replace(
      /[^A-Z0-9]/g,
      "",
    );
}

export function resolveWarehouseCapturePolicy(
  contextId:
    WarehouseCaptureContextId,
  authority:
    WarehouseControlCaptureAuthoritySnapshot,
): ResolvedWarehouseCapturePolicy {
  validateAuthoritySnapshot(
    authority,
  );

  const envelope =
    getCapturePolicyEnvelope(
      contextId,
    );

  const extension =
    readScanditWebConfigurationExtension(
      authority.scannerProfile
        .configuration,
    );

  const enabledDbCodes =
    new Set(
      authority.symbologies
        .filter(
          (symbology) =>
            symbology.enabled,
        )
        .map((symbology) =>
          normalizedCode(
            symbology.symbologyCode,
          ),
        ),
    );

  const warnings:
    CapturePolicyWarning[] = [];

  const effective:
    WarehouseSymbology[] = [];

  const configuredUnsupported:
    string[] = [];

  for (
    const configuredCode of
      authority.scannerProfile
        .supportedSymbologies
  ) {
    const mapped =
      mapWarehouseControlSymbology(
        configuredCode,
      );

    if (!mapped) {
      configuredUnsupported.push(
        configuredCode,
      );
      continue;
    }

    if (
      !enabledDbCodes.has(
        normalizedCode(
          configuredCode,
        ),
      )
    ) {
      warnings.push({
        code:
          "CONFIGURED_SYMBOLOGY_DISABLED_IN_WAREHOUSE_CONTROL",
        detail:
          `Configured symbology ${configuredCode} is not enabled in warehouse_control.barcode_symbologies.`,
      });
      continue;
    }

    if (
      !envelope.allowedSymbologies.includes(
        mapped,
      )
    ) {
      continue;
    }

    if (
      !effective.includes(mapped)
    ) {
      effective.push(mapped);
    }
  }

  if (
    configuredUnsupported.length
  ) {
    throw new CapturePolicyError(
      "CONFIGURED_SYMBOLOGY_UNSUPPORTED",
      "Warehouse Control configured one or more symbologies that 6.2B does not support.",
      {
        unsupported:
          Object.freeze(
            configuredUnsupported,
          ),
      },
    );
  }

  if (!effective.length) {
    throw new CapturePolicyError(
      "NO_EFFECTIVE_SYMBOLOGIES",
      "No effective barcode symbologies remain after Warehouse Control, 6.2B capability, and context-envelope reconciliation.",
    );
  }

  const selection =
    resolveSelection(
      extension.selection,
      authority.scannerProfile
        .autoScanEnabled,
      envelope,
    );

  if (
    selection ===
      "EXPLICIT_CONFIRMATION" &&
    envelope.defaultSelection ===
      "AUTOMATIC"
  ) {
    warnings.push({
      code:
        "AUTOMATIC_CAPTURE_RESTRICTED_BY_CONTEXT",
      detail:
        "Effective selection was restricted to explicit confirmation by authoritative configuration.",
    });
  }

  const scanArea =
    extension.scanArea ??
    envelope.scanAreaBounds
      .defaultArea;

  validateScanArea(
    scanArea,
    envelope,
  );

  const captureTimeoutMs =
    extension.captureTimeoutMs ??
    envelope.captureTimeoutBounds
      .defaultMs;

  validateCaptureTimeout(
    captureTimeoutMs,
    envelope,
  );

  const sound =
    authority.scannerProfile
      .beepEnabled &&
    envelope.feedbackCeiling
      .soundAllowed;

  const vibration =
    authority.scannerProfile
      .vibrationEnabled &&
    envelope.feedbackCeiling
      .vibrationAllowed;

  if (
    authority.scannerProfile
      .beepEnabled &&
    !sound
  ) {
    warnings.push({
      code:
        "SOUND_RESTRICTED_BY_ENVELOPE",
      detail:
        "Warehouse Control requested beep feedback but the context envelope disallows it.",
    });
  }

  if (
    authority.scannerProfile
      .vibrationEnabled &&
    !vibration
  ) {
    warnings.push({
      code:
        "VIBRATION_RESTRICTED_BY_ENVELOPE",
      detail:
        "Warehouse Control requested vibration feedback but the context envelope disallows it.",
    });
  }

  /**
   * Warehouse Control stores duplicate_suppression_ms. 6.2B's permanent
   * execution contract intentionally uses seconds to match the Scandit Web
   * API time interval semantics.
   */
  const duplicateFilterSeconds =
    authority.scannerProfile
      .duplicateSuppressionMs /
    1000;

  const executionPolicy:
    BarcodeCaptureExecutionPolicy =
  Object.freeze({
    symbologies:
      Object.freeze(
        [...effective],
      ),
    duplicateFilterSeconds,
    selection,
    scanArea:
      Object.freeze({
        ...scanArea,
      }),
    feedback:
      Object.freeze({
        sound,
        vibration,
      }),
    lineage:
      Object.freeze({
        policySource:
          "6.2C_VALIDATED_POLICY",
        registryVersion:
          DOMAIN6_2C_POLICY_REGISTRY_VERSION,
        profileId:
          contextId,
        profileRevision: 1,
      }),
  });

  return Object.freeze({
    contextId,
    executionPolicy,
    captureTimeoutMs,
    preferredCamera:
      envelope.preferredCamera,
    authorityEvidence:
      Object.freeze({
        scannerAssetId:
          authority.scannerProfile
            .assetId,
        scannerProfileUpdatedAt:
          authority.scannerProfile
            .updatedAt,
      }),
    warnings:
      Object.freeze(
        warnings,
      ),
  });
}
