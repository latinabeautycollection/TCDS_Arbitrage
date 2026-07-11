export type ScanResult = { barcode: string; symbology: 'CODE128' | 'QR' | 'UNKNOWN' };

export async function startScannerPlaceholder(onScan: (result: ScanResult) => void): Promise<void> {
  console.info('Scandit placeholder active. Wire real Scandit SDK here.');
  window.setTimeout(() => onScan({ barcode: 'INV-2026-000001', symbology: 'CODE128' }), 750);
}
