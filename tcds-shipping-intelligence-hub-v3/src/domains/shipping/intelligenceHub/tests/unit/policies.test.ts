import { classifyDestination } from "../../classifiers/destinationClassifier";
import { classifyMailbox } from "../../classifiers/mailboxClassifier";
import { decideInsurance } from "../../policies/insurancePolicy";
import { decideSignature } from "../../policies/signaturePolicy";

describe("shipping intelligence policies", () => {
  test("classifies California as contiguous US", () => {
    expect(classifyDestination({
      line1: "1 Main St", city: "Los Angeles", stateOrProvince: "CA",
      postalCode: "90001", countryCode: "US"
    })).toBe("CONTIGUOUS_US");
  });

  test("blocks PO boxes", () => {
    expect(classifyMailbox({
      line1: "PO Box 123", city: "Miami", stateOrProvince: "FL",
      postalCode: "33101", countryCode: "US"
    })).toBe("PO_BOX");
  });

  test("requires insurance at 100", () => {
    expect(decideInsurance(100).required).toBe(true);
  });

  test("requires ebay signature at 750", () => {
    expect(decideSignature({
      totalPaidUsd: 750,
      destinationClass: "CONTIGUOUS_US",
      highFraudCategory: false,
      marketplace: "EBAY"
    }).required).toBe(true);
  });
});
