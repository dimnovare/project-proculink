// Book-a-demo destination, shared by every CTA that offers a demo.
//
// Defaults to our own /book-demo request page (honest: a request form we reply
// to within 1 business day — not an instant calendar). NEXT_PUBLIC_BOOK_DEMO_URL
// remains an escape hatch to point at an external scheduler; when set it wins.
export const BOOK_DEMO_URL = process.env.NEXT_PUBLIC_BOOK_DEMO_URL || "/book-demo";

export const BOOK_DEMO_IS_EXTERNAL = BOOK_DEMO_URL.startsWith("http");

/** Spread onto an <a>: opens a new tab only for external URLs, never for the internal route. */
export const BOOK_DEMO_LINK_ATTRS: { target?: string; rel?: string } = BOOK_DEMO_IS_EXTERNAL
  ? { target: "_blank", rel: "noopener noreferrer" }
  : {};
