import type {
  BarcodeScanAreaPolicy,
  BarcodeSelectionPolicy,
} from "../capture/BarcodeCaptureCapability";
import {
  CapturePolicyError,
} from "./CapturePolicyError";

export interface ScanditWebConfigurationExtension {
  readonly captureTimeoutMs?: number;
  readonly selection?:
    BarcodeSelectionPolicy;
  readonly scanArea?:
    BarcodeScanAreaPolicy;
}

export function readScanditWebConfigurationExtension(
  configuration:
    Readonly<Record<string, unknown>> |
    undefined,
): ScanditWebConfigurationExtension {
  if (!configuration) {
    return Object.freeze({});
  }

  const raw =
    configuration.scanditWeb;

  if (
    raw === undefined ||
    raw === null
  ) {
    return Object.freeze({});
  }

  if (
    typeof raw !== "object" ||
    Array.isArray(raw)
  ) {
    throw new CapturePolicyError(
      "INVALID_CONFIGURATION_EXTENSION",
      "warehouse_control.scanner_profiles.configuration.scanditWeb must be an object.",
    );
  }

  const candidate =
    raw as Record<
      string,
      unknown
    >;

  const allowedKeys =
    new Set([
      "captureTimeoutMs",
      "selection",
      "scanArea",
    ]);

  for (
    const key of
      Object.keys(candidate)
  ) {
    if (!allowedKeys.has(key)) {
      throw new CapturePolicyError(
        "INVALID_CONFIGURATION_EXTENSION",
        `Unsupported scanditWeb configuration key: ${key}`,
      );
    }
  }

  const result:
    ScanditWebConfigurationExtension =
      {};

  if (
    candidate.captureTimeoutMs !==
    undefined
  ) {
    if (
      typeof candidate.captureTimeoutMs !==
        "number" ||
      !Number.isFinite(
        candidate.captureTimeoutMs,
      )
    ) {
      throw new CapturePolicyError(
        "INVALID_CONFIGURATION_EXTENSION",
        "captureTimeoutMs must be a finite number.",
      );
    }

    (
      result as {
        captureTimeoutMs?: number;
      }
    ).captureTimeoutMs =
      candidate.captureTimeoutMs;
  }

  if (
    candidate.selection !==
    undefined
  ) {
    if (
      candidate.selection !==
        "AUTOMATIC" &&
      candidate.selection !==
        "EXPLICIT_CONFIRMATION"
    ) {
      throw new CapturePolicyError(
        "INVALID_CONFIGURATION_EXTENSION",
        "selection must be AUTOMATIC or EXPLICIT_CONFIRMATION.",
      );
    }

    (
      result as {
        selection?:
          BarcodeSelectionPolicy;
      }
    ).selection =
      candidate.selection;
  }

  if (
    candidate.scanArea !==
    undefined
  ) {
    const area =
      candidate.scanArea;

    if (
      !area ||
      typeof area !== "object" ||
      Array.isArray(area)
    ) {
      throw new CapturePolicyError(
        "INVALID_CONFIGURATION_EXTENSION",
        "scanArea must be an object.",
      );
    }

    const values =
      area as Record<
        string,
        unknown
      >;

    if (
      typeof values.widthFraction !==
        "number" ||
      typeof values.heightFraction !==
        "number" ||
      !Number.isFinite(
        values.widthFraction,
      ) ||
      !Number.isFinite(
        values.heightFraction,
      )
    ) {
      throw new CapturePolicyError(
        "INVALID_CONFIGURATION_EXTENSION",
        "scanArea widthFraction and heightFraction must be finite numbers.",
      );
    }

    (
      result as {
        scanArea?:
          BarcodeScanAreaPolicy;
      }
    ).scanArea = Object.freeze({
      widthFraction:
        values.widthFraction,
      heightFraction:
        values.heightFraction,
    });
  }

  return Object.freeze(result);
}
