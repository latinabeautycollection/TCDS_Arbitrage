export interface DataKeyEnvelope {
  readonly keyId: string;
  readonly keyVersion: string;
  readonly plaintextDataKey: Buffer;
  readonly encryptedDataKey: string;
}
export interface KeyManagementProvider {
  generateDataKey(context: Readonly<Record<string, string>>): Promise<DataKeyEnvelope>;
  decryptDataKey(input: {
    keyId: string;
    keyVersion: string;
    encryptedDataKey: string;
    context: Readonly<Record<string, string>>;
  }): Promise<Buffer>;
}
