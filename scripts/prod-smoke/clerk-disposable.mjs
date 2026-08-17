#!/usr/bin/env node
/**
 * Disposable Clerk identity for the authenticated production smoke test.
 *
 * `provision` creates a throwaway user + organisation in the PRODUCTION Clerk
 * instance and mints a one-shot sign-in ticket for them. `cleanup` deletes both.
 * Nothing here ever touches the founder's real user or the real workspace: every
 * object it creates is named with the run-scoped prefix below, and cleanup
 * REFUSES to delete anything that does not carry it.
 *
 * ── WHY A TICKET AND NOT A SESSION ───────────────────────────────────────────
 * Two paths were tried against this instance and both are dead ends. Recorded
 * here so the next person does not spend the afternoon re-finding them:
 *
 *   1. Clerk's Native API (`_is_native=1` ticket exchange against FAPI, which
 *      returns a bare session JWT with no browser) is DISABLED on this instance.
 *      It answers `native_api_disabled`.
 *   2. Backend API session creation (`POST /v1/sessions`,
 *      `clerk.sessions.createSession`) is development-only. Against a `sk_live`
 *      key it answers `request_invalid_for_environment`.
 *
 * The path that works, and the one this script implements, is a sign-in TICKET:
 * `POST /v1/sign_in_tokens` mints a token for a user id, and navigating a real
 * browser to `/sign-in?__clerk_ticket=<token>` completes the handshake and lands
 * with genuine `__session` / `__client` cookies. That is a real browser session,
 * which is the only kind that exercises what a customer actually gets.
 *
 * ── WHY STATE GOES TO A FILE, NOT TO STEP OUTPUTS ────────────────────────────
 * The ticket is a bearer credential for 15 minutes. Step outputs and env vars
 * end up in expressions that are easy to echo by accident; a file in the
 * workspace is read by exactly the two things that need it (the Playwright auth
 * setup, and the cleanup step) and never rendered into a log line. The ticket is
 * additionally registered with `::add-mask::` so that if some future step does
 * print it, Actions redacts it.
 *
 * Usage:
 *   node scripts/prod-smoke/clerk-disposable.mjs provision
 *   node scripts/prod-smoke/clerk-disposable.mjs cleanup
 *
 * Environment:
 *   CLERK_SECRET_KEY            required. The production `sk_live_…` secret.
 *   PROD_SMOKE_RUN_ID           required for provision. Makes names unique.
 *   PROD_SMOKE_EMAIL_DOMAIN     optional. Defaults to `example.com` (RFC 2606
 *                               reserved — it can never reach a real inbox).
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";

const CLERK_API = "https://api.clerk.com/v1";

/**
 * Every disposable object carries this prefix, and `cleanup` deletes NOTHING
 * whose name lacks it. That refusal is the guardrail: a bug that resolved the
 * wrong organisation id would otherwise delete a real customer workspace, and
 * "the id came from our own state file" is not a safety property — it is an
 * assumption. The prefix is checked against the object Clerk returns, not
 * against the one we think we created.
 */
export const DISPOSABLE_PREFIX = "proculink-ci-smoke";

/** Where provision writes what cleanup must read. Gitignored; workspace-local. */
const STATE_PATH = resolve(process.cwd(), ".prod-smoke/state.json");

/**
 * Ticket lifetime. Clerk's default is 30 days, which is an absurd blast radius
 * for a credential whose entire job is one navigation ~60 seconds from now.
 */
const TICKET_TTL_SECONDS = 900;

function secretKey() {
  const key = process.env.CLERK_SECRET_KEY;
  if (!key) throw new Error("CLERK_SECRET_KEY is not set.");
  return key;
}

async function clerk(path, { method = "GET", body } = {}) {
  const res = await fetch(`${CLERK_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey()}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    // Clerk error bodies name the field and the code, and carry no credential —
    // they are the whole diagnosis, so they are surfaced verbatim.
    throw new Error(`Clerk ${method} ${path} → HTTP ${res.status}: ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

/** Mask a value in the Actions log, and never print it ourselves. */
function mask(value) {
  if (process.env.GITHUB_ACTIONS === "true") console.log(`::add-mask::${value}`);
}

function writeState(state) {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function readState() {
  if (!existsSync(STATE_PATH)) return null;
  return JSON.parse(readFileSync(STATE_PATH, "utf8"));
}

async function provision() {
  const runId = process.env.PROD_SMOKE_RUN_ID;
  if (!runId) throw new Error("PROD_SMOKE_RUN_ID is not set.");
  const domain = process.env.PROD_SMOKE_EMAIL_DOMAIN || "example.com";

  const slug = `${DISPOSABLE_PREFIX}-${runId}`;
  const email = `${slug}@${domain}`;

  // The first name is not decoration. The dashboard greets by first name
  // (DashboardContextLine), so a unique value here gives the spec one assertion
  // that can only pass if a real Clerk session hydrated in a real browser
  // against production — see tests/prod/signed-in-screens.spec.ts.
  const firstName = `Smoke${runId}`;

  const user = await clerk("/users", {
    method: "POST",
    body: {
      email_address: [email],
      first_name: firstName,
      last_name: "Disposable",
      skip_password_requirement: true,
      // Not a real person; this exists to make the object obvious in the Clerk
      // dashboard if cleanup ever fails to run.
      public_metadata: { proculinkDisposable: true, runId },
    },
  });

  // The organisation is created explicitly rather than left to the app's
  // /onboarding/select-organization auto-create, so its NAME is ours and the
  // prefix guard in cleanup has something to check. Without this the app would
  // create one called something derived from the user, and cleanup would be
  // deleting an object it cannot prove it owns.
  const org = await clerk("/organizations", {
    method: "POST",
    body: {
      name: slug,
      created_by: user.id,
      public_metadata: { proculinkDisposable: true, runId },
    },
  });

  const ticket = await clerk("/sign_in_tokens", {
    method: "POST",
    body: { user_id: user.id, expires_in_seconds: TICKET_TTL_SECONDS },
  });

  mask(ticket.token);

  writeState({
    runId,
    userId: user.id,
    orgId: org.id,
    orgName: org.name,
    email,
    firstName,
    ticket: ticket.token,
  });

  // Ids are safe to print and are the only handle a human has if cleanup fails.
  console.log(`Provisioned disposable Clerk identity for run ${runId}`);
  console.log(`  user: ${user.id}`);
  console.log(`  org:  ${org.id} (${org.name})`);
}

/**
 * Delete the organisation(s) and the user.
 *
 * Runs under `if: always()`, so it must tolerate a provision that got partway
 * and a provision that never ran at all. It reports every deletion and every
 * refusal, and it exits non-zero if anything it was asked to delete survives —
 * a cleanup that silently left a user behind is how a Clerk instance fills up
 * with ghosts nobody can attribute.
 */
async function cleanup() {
  const state = readState();
  if (!state) {
    console.log("No .prod-smoke/state.json — provision never ran. Nothing to clean up.");
    return;
  }

  const failures = [];

  // Enumerate memberships rather than trusting the single org id in state: if
  // the app's org gate ever auto-created a SECOND organisation for this user,
  // deleting only the one we recorded would leave the other behind forever.
  let memberships = [];
  try {
    const res = await clerk(`/users/${state.userId}/organization_memberships?limit=100`);
    memberships = res?.data ?? [];
  } catch (err) {
    // A 404 here means the user is already gone, which is the desired end state.
    console.log(`Could not list memberships (continuing): ${err.message}`);
  }

  for (const membership of memberships) {
    const org = membership.organization;
    if (!org?.id) continue;
    if (!String(org.name ?? "").startsWith(DISPOSABLE_PREFIX)) {
      // Refuse rather than delete. Reaching this line means our disposable user
      // is a member of something we did not create, which is a bug worth failing
      // the job over — but deleting it would be far worse than reporting it.
      failures.push(
        `REFUSED to delete organisation ${org.id} named "${org.name}": it does not ` +
          `start with "${DISPOSABLE_PREFIX}", so this script cannot prove it created it. ` +
          `Delete it by hand after checking what it is.`,
      );
      continue;
    }
    try {
      await clerk(`/organizations/${org.id}`, { method: "DELETE" });
      console.log(`Deleted organisation ${org.id} (${org.name})`);
    } catch (err) {
      failures.push(`Failed to delete organisation ${org.id}: ${err.message}`);
    }
  }

  try {
    await clerk(`/users/${state.userId}`, { method: "DELETE" });
    console.log(`Deleted user ${state.userId}`);
  } catch (err) {
    failures.push(`Failed to delete user ${state.userId}: ${err.message}`);
  }

  // The state file holds the ticket. Remove it even when deletion failed, so a
  // live credential does not survive into an uploaded artifact.
  rmSync(dirname(STATE_PATH), { recursive: true, force: true });

  if (failures.length > 0) {
    for (const f of failures) console.error(`::error title=Disposable cleanup::${f}`);
    throw new Error(`${failures.length} cleanup step(s) failed — see the errors above.`);
  }
  console.log("Cleanup complete: no disposable objects left behind.");
}

const command = process.argv[2];
const commands = { provision, cleanup };

if (!commands[command]) {
  console.error(`Usage: node scripts/prod-smoke/clerk-disposable.mjs <provision|cleanup>`);
  process.exit(2);
}

commands[command]().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
