import {
  DataCaptureView,
  MarginsWithUnit,
  MeasureUnit,
  NumberWithUnit,
  PointWithUnit,
} from "@scandit/web-datacapture-core";
import type {
  DataCaptureContext,
} from "@scandit/web-datacapture-core";

import {
  DOMAIN6_2B_CERTIFICATION_POLICY,
  type BarcodeScanAreaPolicy,
} from "../../capture/BarcodeCaptureCapability";

function fraction(
  value: number,
): NumberWithUnit {
  return new NumberWithUnit(
    value,
    MeasureUnit.Fraction,
  );
}

export function assertScanAreaPolicy(
  area: BarcodeScanAreaPolicy,
): void {
  if (
    !Number.isFinite(
      area.widthFraction,
    ) ||
    !Number.isFinite(
      area.heightFraction,
    ) ||
    area.widthFraction <= 0 ||
    area.widthFraction > 1 ||
    area.heightFraction <= 0 ||
    area.heightFraction > 1
  ) {
    throw new Error(
      "Invalid BarcodeCapture scan area.",
    );
  }
}

export function scanAreaMarginsFor(
  area: BarcodeScanAreaPolicy,
): Readonly<{
  left: number;
  right: number;
  top: number;
  bottom: number;
}> {
  assertScanAreaPolicy(area);

  const horizontal =
    (1 - area.widthFraction) / 2;
  const vertical =
    (1 - area.heightFraction) / 2;

  return Object.freeze({
    left: horizontal,
    right: horizontal,
    top: vertical,
    bottom: vertical,
  });
}

export const DOMAIN6_2B_SCAN_AREA =
  Object.freeze({
    ...scanAreaMarginsFor(
      DOMAIN6_2B_CERTIFICATION_POLICY
        .scanArea,
    ),
    width:
      DOMAIN6_2B_CERTIFICATION_POLICY
        .scanArea.widthFraction,
    height:
      DOMAIN6_2B_CERTIFICATION_POLICY
        .scanArea.heightFraction,
  });

export async function createAndAttachScanditView(
  context: DataCaptureContext,
  element: HTMLElement,
  area:
    BarcodeScanAreaPolicy =
      DOMAIN6_2B_CERTIFICATION_POLICY
        .scanArea,
): Promise<DataCaptureView> {
  const view =
    await DataCaptureView.forContext(
      context,
    );

  await view.allowPictureInPicture(
    false,
  );

  const margins =
    scanAreaMarginsFor(area);

  view.scanAreaMargins =
    new MarginsWithUnit(
      fraction(margins.left),
      fraction(margins.top),
      fraction(margins.right),
      fraction(margins.bottom),
    );

  view.pointOfInterest =
    new PointWithUnit(
      fraction(0.5),
      fraction(0.5),
    );

  view.connectToElement(element);

  return view;
}

export function detachScanditView(
  view: DataCaptureView | null,
): void {
  view?.detachFromElement();
}
