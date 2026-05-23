/**
 * MSW browser setup — imported once from the client root.
 * Only active when NEXT_PUBLIC_MSW=true (set in .env.development).
 */

import { setupWorker } from "msw/browser";
import { handlers } from "./handlers";

export const worker = setupWorker(...handlers);
