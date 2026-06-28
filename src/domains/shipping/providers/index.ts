// Merged providers/index.ts for src/domains/shipping/providers/
// Union of ALL Domain 3 carrier bundles + the ShipEngine integration layer.
// Overwrite the per-bundle index.ts with this AFTER copying every bundle in.
// v2 patch files are deferred (kept in the shipengine bundle's _deferred_v2/).

// ShipEngine integration layer (multi-carrier rate/label/tracking; buy-gate path)
export * from "./carrierAdapter";
export * from "./carrierFactory";
export * from "./shipEngineCarrierAdapter";
export * from "./shipEngineClient";
export * from "./shipEngineApi";

// Direct carrier API clients
export * from "./fedexClient";
export * from "./fedexApi";
export * from "./uspsClient";
export * from "./uspsApi";
export * from "./upsClient";
export * from "./upsApi";
export * from "./dhlClient";
export * from "./dhlApi";
