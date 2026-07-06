export type WarehouseProfile = {
  warehouseKey: string;
  warehouseName: string;
  attentionTo: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  stateCode: string;
  postalCode: string;
  countryCode: "US";
};

export const defaultWarehouseProfile: WarehouseProfile = {
  warehouseKey: process.env.TCDS_SHIP_FROM_WAREHOUSE_ID ?? "tcds_stafford_va_001",
  warehouseName: process.env.TCDS_SHIP_FROM_NAME ?? "Total Coverage Database Solutions LLC - Stafford Warehouse",
  attentionTo: process.env.TCDS_SHIP_FROM_ATTENTION ?? "Total Coverage Database Solutions LLC",
  addressLine1: process.env.TCDS_SHIP_FROM_ADDRESS1 ?? "184 Boxelder Drive",
  addressLine2: process.env.TCDS_SHIP_FROM_ADDRESS2 || undefined,
  city: process.env.TCDS_SHIP_FROM_CITY ?? "Stafford",
  stateCode: process.env.TCDS_SHIP_FROM_STATE ?? "VA",
  postalCode: process.env.TCDS_SHIP_FROM_POSTAL_CODE ?? "22026",
  countryCode: "US",
};

export function assertWarehouseProfile(profile: WarehouseProfile): void {
  if (!/^\d{5}(-\d{4})?$/.test(profile.postalCode)) {
    throw new Error(`Invalid warehouse postal code: ${profile.postalCode}`);
  }
  if (!/^[A-Z]{2}$/.test(profile.stateCode)) {
    throw new Error(`Invalid warehouse state code: ${profile.stateCode}`);
  }
}
