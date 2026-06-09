import { describe, expect, it } from "vitest";
import {
  COPYRIGHT_NOTICE,
  LEGAL_ENTITY,
  LEGAL_ENTITY_REFERENCE,
  ORGANIZATION_STRUCTURED_DATA,
  PRODUCT_OPERATOR_NOTICE,
} from "@/lib/legal-entity";

describe("legal entity identity", () => {
  it("keeps ProcuLink as the product operated by Diip Solutions OÜ", () => {
    expect(LEGAL_ENTITY).toEqual({
      productName: "ProcuLink",
      legalName: "Diip Solutions OÜ",
      registryCode: "17527757",
      registeredAddress: "Uus-Sadama tn 15-2, 10120 Tallinn, Estonia",
      countryCode: "EE",
    });

    expect(LEGAL_ENTITY_REFERENCE).toBe(
      "Diip Solutions OÜ, registry code 17527757, Uus-Sadama tn 15-2, 10120 Tallinn, Estonia",
    );
    expect(PRODUCT_OPERATOR_NOTICE).toBe(
      "ProcuLink is a product operated by Diip Solutions OÜ, registry code 17527757, registered at Uus-Sadama tn 15-2, 10120 Tallinn, Estonia.",
    );
    expect(COPYRIGHT_NOTICE).toBe("© 2026 Diip Solutions OÜ · ProcuLink");
  });

  it("publishes the legal entity and product brand in Organization structured data", () => {
    expect(ORGANIZATION_STRUCTURED_DATA).toMatchObject({
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "Diip Solutions OÜ",
      alternateName: "ProcuLink",
      url: "https://proculink.eu",
      identifier: "17527757",
      address: {
        "@type": "PostalAddress",
        streetAddress: "Uus-Sadama tn 15-2",
        postalCode: "10120",
        addressLocality: "Tallinn",
        addressCountry: "EE",
      },
    });
  });

  it("does not retain the old company identity", () => {
    const identity = JSON.stringify({
      LEGAL_ENTITY,
      LEGAL_ENTITY_REFERENCE,
      PRODUCT_OPERATOR_NOTICE,
      COPYRIGHT_NOTICE,
      ORGANIZATION_STRUCTURED_DATA,
    });

    expect(identity).not.toContain("ProcuLink OÜ");
    expect(identity).not.toContain("17477775");
    expect(identity).not.toContain("Katusepapi");
  });
});
