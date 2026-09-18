export interface ScannerProviderMetadata {
  providerId: string;
  providerName: string;
  providerVersion: string;
  runtimeAssetVersion: string;
  implementationVersion: string;
  capabilities: readonly string[];
  libraryLocation?: string;
}
