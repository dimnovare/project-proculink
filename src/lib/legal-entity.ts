export const LEGAL_ENTITY = {
  productName: "ProcuLink",
  legalName: "Diip Solutions OÜ",
  registryCode: "17527757",
  registeredAddress: "Uus-Sadama tn 15-2, 10120 Tallinn, Estonia",
  countryCode: "EE",
} as const;

export const LEGAL_ENTITY_REFERENCE =
  `${LEGAL_ENTITY.legalName}, registry code ${LEGAL_ENTITY.registryCode}, ${LEGAL_ENTITY.registeredAddress}`;

export const PRODUCT_OPERATOR_NOTICE =
  `${LEGAL_ENTITY.productName} is a product operated by ${LEGAL_ENTITY.legalName}, registry code ${LEGAL_ENTITY.registryCode}, registered at ${LEGAL_ENTITY.registeredAddress}.`;

/** Where the company is registered, as a buyer would look it up. */
const REGISTERED_LOCALITY = { city: "Tallinn", country: "Estonia" } as const;

/**
 * The company trust line: the accountable legal entity, its Estonian business-register code and
 * where it is registered. A procurement buyer checks the company before contracting with it, and
 * these three facts are what they need to do that without a founder or "about me" page.
 */
export const COMPANY_TRUST_LINE =
  `${LEGAL_ENTITY.legalName} · Registry code ${LEGAL_ENTITY.registryCode} · ${REGISTERED_LOCALITY.city}, ${REGISTERED_LOCALITY.country}`;

/**
 * Footer notice on every public page — the copyright holder is the legal entity, followed by the
 * trust line, so the registry code is one glance away on every page rather than only on /privacy.
 */
export const COPYRIGHT_NOTICE = `© 2026 ${COMPANY_TRUST_LINE}`;

export const ORGANIZATION_STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: LEGAL_ENTITY.legalName,
  alternateName: LEGAL_ENTITY.productName,
  url: "https://proculink.eu",
  identifier: LEGAL_ENTITY.registryCode,
  address: {
    "@type": "PostalAddress",
    streetAddress: "Uus-Sadama tn 15-2",
    postalCode: "10120",
    addressLocality: REGISTERED_LOCALITY.city,
    addressCountry: LEGAL_ENTITY.countryCode,
  },
} as const;
