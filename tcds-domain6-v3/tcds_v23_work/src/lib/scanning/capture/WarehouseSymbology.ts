export type WarehouseSymbology =
  | "CODE128"
  | "EAN13_UPCA"
  | "QR";

export const DOMAIN6_2B_CERTIFICATION_SYMBOLOGIES: readonly WarehouseSymbology[] = [
  "CODE128",
  "EAN13_UPCA",
  "QR",
] as const;
