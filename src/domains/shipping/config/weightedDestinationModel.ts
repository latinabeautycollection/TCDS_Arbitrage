export type WeightedDestinationRegionGroup =
  | "SOUTH"
  | "SOUTHWEST"
  | "NORTH"
  | "NORTHEAST"
  | "CENTRAL"
  | "WEST"
  | "NORTHWEST";

export type WeightedDestinationZip = {
  regionGroup: WeightedDestinationRegionGroup;
  marketName: string;
  city: string;
  stateCode: string;
  postalCode: string;
  weight: number;
  priority: number;
  seasonalCostMultiplier?: number;
  seasonalDelayRiskMultiplier?: number;
};

export const DEFAULT_WEIGHTED_DESTINATION_MODEL_KEY =
  process.env.TCDS_PREPURCHASE_DESTINATION_MODEL ?? "tcds_default_propertyroom_retail_us_v2";

export const defaultWeightedDestinationZips: WeightedDestinationZip[] = [
  { regionGroup: "SOUTH", marketName: "Miami FL", city: "Miami", stateCode: "FL", postalCode: "33101", weight: 0.06, priority: 10 },
  { regionGroup: "SOUTH", marketName: "Atlanta GA", city: "Atlanta", stateCode: "GA", postalCode: "30303", weight: 0.06, priority: 20 },
  { regionGroup: "SOUTH", marketName: "Columbia SC", city: "Columbia", stateCode: "SC", postalCode: "29201", weight: 0.04, priority: 30 },
  { regionGroup: "SOUTHWEST", marketName: "Memphis TN", city: "Memphis", stateCode: "TN", postalCode: "38103", weight: 0.05, priority: 40 },
  { regionGroup: "SOUTHWEST", marketName: "Shreveport LA", city: "Shreveport", stateCode: "LA", postalCode: "71101", weight: 0.04, priority: 50 },
  { regionGroup: "SOUTHWEST", marketName: "Austin TX", city: "Austin", stateCode: "TX", postalCode: "78701", weight: 0.06, priority: 60 },
  { regionGroup: "NORTH", marketName: "Baltimore MD", city: "Baltimore", stateCode: "MD", postalCode: "21201", weight: 0.055, priority: 70 },
  { regionGroup: "NORTH", marketName: "New York City NY", city: "New York", stateCode: "NY", postalCode: "10001", weight: 0.08, priority: 80 },
  { regionGroup: "NORTH", marketName: "Augusta ME", city: "Augusta", stateCode: "ME", postalCode: "04330", weight: 0.03, priority: 90 },
  { regionGroup: "NORTHEAST", marketName: "Detroit MI", city: "Detroit", stateCode: "MI", postalCode: "48226", weight: 0.05, priority: 100 },
  { regionGroup: "NORTHEAST", marketName: "Indianapolis IN", city: "Indianapolis", stateCode: "IN", postalCode: "46204", weight: 0.05, priority: 110 },
  { regionGroup: "CENTRAL", marketName: "Saint Paul MN", city: "Saint Paul", stateCode: "MN", postalCode: "55101", weight: 0.045, priority: 120 },
  { regionGroup: "CENTRAL", marketName: "Cheyenne WY", city: "Cheyenne", stateCode: "WY", postalCode: "82001", weight: 0.025, priority: 130 },
  { regionGroup: "WEST", marketName: "Las Vegas NV", city: "Las Vegas", stateCode: "NV", postalCode: "89101", weight: 0.05, priority: 140 },
  { regionGroup: "WEST", marketName: "Phoenix AZ", city: "Phoenix", stateCode: "AZ", postalCode: "85004", weight: 0.06, priority: 150 },
  { regionGroup: "WEST", marketName: "Los Angeles CA", city: "Los Angeles", stateCode: "CA", postalCode: "90012", weight: 0.09, priority: 160 },
  { regionGroup: "NORTHWEST", marketName: "Portland OR", city: "Portland", stateCode: "OR", postalCode: "97204", weight: 0.045, priority: 170 },
  { regionGroup: "NORTHWEST", marketName: "Seattle WA", city: "Seattle", stateCode: "WA", postalCode: "98101", weight: 0.05, priority: 180 },
];

export function assertWeightedDestinationModel(destinations = defaultWeightedDestinationZips): void {
  if (!destinations.length) throw new Error("Weighted destination model is empty.");
  const total = destinations.reduce((sum, d) => sum + d.weight, 0);
  if (Math.abs(total - 1) > 0.0001) {
    throw new Error(`Weighted destination model must sum to 1. Current sum=${total}`);
  }
  for (const d of destinations) {
    if (!/^\d{5}$/.test(d.postalCode)) throw new Error(`Invalid destination ZIP: ${d.marketName} ${d.postalCode}`);
    if (!/^[A-Z]{2}$/.test(d.stateCode)) throw new Error(`Invalid destination state: ${d.marketName} ${d.stateCode}`);
    if (d.weight <= 0 || d.weight > 1) throw new Error(`Invalid destination weight: ${d.marketName} ${d.weight}`);
  }
}
