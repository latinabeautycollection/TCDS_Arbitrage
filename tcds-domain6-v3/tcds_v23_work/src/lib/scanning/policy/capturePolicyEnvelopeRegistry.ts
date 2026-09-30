import type {
  CapturePolicyEnvelope,
} from "./CapturePolicyEnvelope";
import type {
  WarehouseCaptureContextId,
} from "./WarehouseCaptureContext";

export const DOMAIN6_2C_POLICY_REGISTRY_VERSION =
  "6.2C.2";

const STANDARD_AREA = Object.freeze({
  widthFraction: 0.70,
  heightFraction: 0.35,
});

const TIGHT_AREA = Object.freeze({
  widthFraction: 0.60,
  heightFraction: 0.30,
});

const WIDE_AREA = Object.freeze({
  widthFraction: 0.82,
  heightFraction: 0.46,
});

function envelope(
  contextId: WarehouseCaptureContextId,
  config: Omit<
    CapturePolicyEnvelope,
    "contextId"
  >,
): CapturePolicyEnvelope {
  return Object.freeze({
    contextId,
    ...config,
  });
}

const ITEM_SYMBOLOGIES =
  Object.freeze([
    "CODE128",
    "EAN13_UPCA",
    "QR",
  ] as const);

const LOCATION_SYMBOLOGIES =
  Object.freeze([
    "CODE128",
    "QR",
  ] as const);

const PACKAGE_SYMBOLOGIES =
  Object.freeze([
    "CODE128",
    "QR",
  ] as const);

const base = (
  allowedSymbologies:
    CapturePolicyEnvelope["allowedSymbologies"],
  defaultArea:
    CapturePolicyEnvelope["scanAreaBounds"]["defaultArea"],
  operatorHint: string,
  defaultSelection:
    CapturePolicyEnvelope["defaultSelection"] =
      "AUTOMATIC",
): Omit<
  CapturePolicyEnvelope,
  "contextId"
> => ({
  allowedSymbologies,
  defaultSelection,
  allowAutomaticSelection:
    defaultSelection ===
    "AUTOMATIC",
  scanAreaBounds: Object.freeze({
    minWidthFraction: 0.45,
    maxWidthFraction: 0.90,
    minHeightFraction: 0.25,
    maxHeightFraction: 0.60,
    defaultArea,
  }),
  feedbackCeiling: Object.freeze({
    soundAllowed: true,
    vibrationAllowed: true,
  }),
  captureTimeoutBounds:
    Object.freeze({
      minimumMs: 5_000,
      maximumMs: 120_000,
      defaultMs: 45_000,
    }),
  preferredCamera: "WORLD_FACING",
  operatorHint,
});

const REGISTRY = {
  RECEIVING_PACKAGE: envelope(
    "RECEIVING_PACKAGE",
    base(
      PACKAGE_SYMBOLOGIES,
      WIDE_AREA,
      "Center one package barcode in the scan area.",
    ),
  ),
  RECEIVING_ITEM: envelope(
    "RECEIVING_ITEM",
    base(
      ITEM_SYMBOLOGIES,
      STANDARD_AREA,
      "Center one product barcode in the scan area.",
    ),
  ),
  RECEIVING_SERIAL: envelope(
    "RECEIVING_SERIAL",
    base(
      LOCATION_SYMBOLOGIES,
      TIGHT_AREA,
      "Aim at one serial barcode and explicitly confirm the intended code.",
      "EXPLICIT_CONFIRMATION",
    ),
  ),
  PUTAWAY_ITEM: envelope(
    "PUTAWAY_ITEM",
    base(
      ITEM_SYMBOLOGIES,
      STANDARD_AREA,
      "Center one item barcode in the scan area.",
    ),
  ),
  PUTAWAY_LOCATION: envelope(
    "PUTAWAY_LOCATION",
    base(
      LOCATION_SYMBOLOGIES,
      TIGHT_AREA,
      "Center one warehouse location label in the scan area.",
    ),
  ),
  PICK_LOCATION: envelope(
    "PICK_LOCATION",
    base(
      LOCATION_SYMBOLOGIES,
      TIGHT_AREA,
      "Center one warehouse location label in the scan area.",
    ),
  ),
  PICK_ITEM: envelope(
    "PICK_ITEM",
    base(
      ITEM_SYMBOLOGIES,
      STANDARD_AREA,
      "Center one item barcode in the scan area.",
    ),
  ),
  PICK_DESTINATION: envelope(
    "PICK_DESTINATION",
    base(
      LOCATION_SYMBOLOGIES,
      TIGHT_AREA,
      "Center one destination label in the scan area.",
    ),
  ),
  PACK_ITEM: envelope(
    "PACK_ITEM",
    base(
      ITEM_SYMBOLOGIES,
      STANDARD_AREA,
      "Center one item barcode in the scan area.",
    ),
  ),
  PACK_PACKAGE: envelope(
    "PACK_PACKAGE",
    base(
      PACKAGE_SYMBOLOGIES,
      WIDE_AREA,
      "Center one package barcode in the scan area.",
    ),
  ),
  TRACKING_LABEL: envelope(
    "TRACKING_LABEL",
    base(
      PACKAGE_SYMBOLOGIES,
      WIDE_AREA,
      "Center one tracking barcode in the scan area.",
    ),
  ),
  RETURN_PACKAGE: envelope(
    "RETURN_PACKAGE",
    base(
      PACKAGE_SYMBOLOGIES,
      WIDE_AREA,
      "Center one return package barcode in the scan area.",
    ),
  ),
  RETURN_ITEM: envelope(
    "RETURN_ITEM",
    base(
      ITEM_SYMBOLOGIES,
      STANDARD_AREA,
      "Center one item barcode in the scan area.",
    ),
  ),
  RETURN_SERIAL: envelope(
    "RETURN_SERIAL",
    base(
      LOCATION_SYMBOLOGIES,
      TIGHT_AREA,
      "Aim at one serial barcode and explicitly confirm the intended code.",
      "EXPLICIT_CONFIRMATION",
    ),
  ),
  INVENTORY_LOOKUP: envelope(
    "INVENTORY_LOOKUP",
    base(
      ITEM_SYMBOLOGIES,
      STANDARD_AREA,
      "Center one barcode in the scan area.",
    ),
  ),
  CYCLE_COUNT: envelope(
    "CYCLE_COUNT",
    base(
      ITEM_SYMBOLOGIES,
      STANDARD_AREA,
      "Center one item barcode in the scan area.",
    ),
  ),
} as const satisfies Readonly<
  Record<
    WarehouseCaptureContextId,
    CapturePolicyEnvelope
  >
>;

export const CAPTURE_POLICY_ENVELOPES =
  Object.freeze(REGISTRY);

export function getCapturePolicyEnvelope(
  contextId:
    WarehouseCaptureContextId,
): CapturePolicyEnvelope {
  return CAPTURE_POLICY_ENVELOPES[
    contextId
  ];
}

export function listCapturePolicyEnvelopes():
  readonly CapturePolicyEnvelope[] {
  return Object.freeze(
    Object.values(
      CAPTURE_POLICY_ENVELOPES,
    ),
  );
}
