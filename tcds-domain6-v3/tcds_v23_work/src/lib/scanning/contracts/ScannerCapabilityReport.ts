export interface ScannerCapabilityReport {
  supported: boolean;
  degraded: boolean;
  secureContext: boolean;
  webAssembly: boolean;
  webWorkers: boolean;
  blob: boolean;
  objectUrl: boolean;
  mediaDevices: boolean;
  getUserMedia: boolean;
  sharedArrayBuffer: boolean;
  offscreenCanvas: boolean;
  webGL: boolean;
  hardwareConcurrency?: number;
  userAgent: string;
  reasons: string[];
  degradedReasons: string[];
  providerCompatibility?: {
    fullSupport: boolean;
    scannerSupport: boolean;
    missingFeatures: string[];
  };
}
