import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The disposable Clerk identity this run is using, and where its browser session
 * is cached.
 *
 * A PLAIN module with no `test()` / `setup()` call in it, on purpose.
 * playwright.prod.config.ts needs `STORAGE_STATE` to configure the `prod`
 * project, and a Playwright config may not import a file that declares tests —
 * doing so fails at config load with "Playwright Test did not expect test() to
 * be called here", before a single spec runs. So the constant and the reader
 * live here, and auth.setup.ts imports them rather than owning them.
 *
 * Both the file and its contents are produced by
 * scripts/prod-smoke/clerk-disposable.mjs; see that script's header for why a
 * sign-in ticket is the only path that works on this Clerk instance.
 */

/** Where the redeemed production session is cached between the two projects. */
export const STORAGE_STATE = resolve(process.cwd(), ".prod-smoke/storage-state.json");

const STATE_PATH = resolve(process.cwd(), ".prod-smoke/state.json");

export interface DisposableState {
  runId: string;
  userId: string;
  orgId: string;
  orgName: string;
  email: string;
  /** Unique per run, and printed by the dashboard greeting — see the spec. */
  firstName: string;
  /** Single-use Clerk sign-in ticket. Redeemed once, by auth.setup.ts. */
  ticket: string;
}

export function readDisposableState(): DisposableState {
  try {
    return JSON.parse(readFileSync(STATE_PATH, "utf8")) as DisposableState;
  } catch {
    throw new Error(
      `No disposable Clerk state at ${STATE_PATH}. Run ` +
        `\`node scripts/prod-smoke/clerk-disposable.mjs provision\` first — this suite ` +
        `cannot sign in to production without it.`,
    );
  }
}
