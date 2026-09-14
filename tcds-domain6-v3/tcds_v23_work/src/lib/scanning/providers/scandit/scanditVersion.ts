export const APPROVED_SCANDIT_VERSION = '8.5.2' as const;
export function assertApprovedScanditVersion(version: string): string { if (!version) throw new Error('Scandit version missing.'); return version; }
