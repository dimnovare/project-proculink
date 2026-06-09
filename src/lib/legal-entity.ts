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

export const COPYRIGHT_NOTICE =
  `© 2026 ${LEGAL_ENTITY.legalName} · ${LEGAL_ENTITY.productName}`;

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
    addressLocality: "Tallinn",
    addressCountry: LEGAL_ENTITY.countryCode,
  },
} as const;
