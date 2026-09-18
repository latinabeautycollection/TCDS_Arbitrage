import type {
  RefCallback,
} from "react";
import {
  DOMAIN6_2B_SCAN_AREA,
} from "../../lib/scanning/providers/scandit/scanditDataCaptureView";

export interface ScannerViewportProps {
  viewportRef: RefCallback<HTMLDivElement>;
  phase: string;
}

export function ScannerViewport({
  viewportRef,
  phase,
}: ScannerViewportProps) {
  const scanAreaStyle = {
    left: `${DOMAIN6_2B_SCAN_AREA.left * 100}%`,
    right: `${DOMAIN6_2B_SCAN_AREA.right * 100}%`,
    top: `${DOMAIN6_2B_SCAN_AREA.top * 100}%`,
    bottom: `${DOMAIN6_2B_SCAN_AREA.bottom * 100}%`,
  } as const;

  return (
    <div
      className="relative min-h-[22rem] overflow-hidden rounded-2xl border border-slate-700 bg-black shadow-inner"
      aria-label="Barcode scanner camera viewport"
    >
      <div
        ref={viewportRef}
        className="absolute inset-0"
      />

      <div
        className="pointer-events-none absolute rounded-xl border-2 border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.20)]"
        style={scanAreaStyle}
        aria-hidden="true"
      />

      <div className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/70 px-3 py-1 text-xs font-medium text-white">
        {phase}
      </div>
    </div>
  );
}
