import { expect, test } from "@playwright/test";
import {
  FilmClock,
  FilmCursor,
  narrationBudgets,
  prepareFilmPage,
  required,
  saveFilmVideo,
} from "./capture-helpers";
import { loadFilmSpec } from "./film-spec";

test("film: walkthrough 2026-07", async ({ page }) => {
  const spec = loadFilmSpec("walkthrough-2026-07");
  const budgets = narrationBudgets(spec);
  const clock = new FilmClock();
  const cursor = new FilmCursor(page);

  const hold = async (beatId: string) => {
    const remaining = budgets[beatId] - clock.since(beatId);
    if (remaining > 0) await page.waitForTimeout(remaining);
  };

  await prepareFilmPage(page);

  // Compile and settle every filmed route before recording the first beat.
  for (const route of ["/upload", "/inbox/ord-002", "/operations/log"]) {
    await page.goto(route, { waitUntil: "networkidle" });
  }

  await page.goto("/upload", { waitUntil: "networkidle" });
  await required(
    page.getByRole("heading", { name: /upload an order/i }),
    "upload heading",
  );

  clock.mark("open");
  await hold("open");

  clock.mark("intake-tools");
  const intakeRail = page.getByRole("heading", {
    name: /more ways to bring orders in/i,
  });
  await required(intakeRail, "intake methods rail");
  await intakeRail.scrollIntoViewIfNeeded();
  await required(page.getByText(/email intake/i), "email intake method");
  await required(page.getByText(/rest api & webhooks/i), "api intake method");
  await required(page.getByText(/sftp pull/i), "sftp intake method");
  await required(page.getByText(/s3 \/ r2 pull/i), "s3 r2 intake method");
  await hold("intake-tools");

  clock.mark("import");
  const sampleButton = page.getByRole("button", {
    name: /try with a sample order/i,
  });
  await required(sampleButton, "sample order CTA");
  await sampleButton.scrollIntoViewIfNeeded();
  await cursor.click(sampleButton);
  await expect(page).toHaveURL(/\/inbox\/ord-sample-/);
  await hold("import");

  // Continue with the richer fictional order because the clean generated sample
  // has no mapping exceptions to resolve on camera.
  await page.goto("/inbox/ord-002", { waitUntil: "networkidle" });
  await required(
    page.getByTitle("PO-2024-005678", { exact: true }),
    "review PO",
  );
  const issues = page.getByTestId("issues-panel");
  await required(issues, "open issues panel");
  await expect(issues).toHaveAttribute("data-issues", "2");
  clock.mark("review");
  await hold("review");

  const line2Issue = issues.getByTestId("issue-row").filter({
    has: page.getByRole("button", { name: /go to line 2/i }),
  });
  clock.mark("suggest");
  await cursor.click(
    line2Issue.getByRole("button", { name: /accept suggestion/i }),
  );
  await expect(issues).toHaveAttribute("data-issues", "1");
  await hold("suggest");

  const line4Issue = issues.getByTestId("issue-row").filter({
    has: page.getByRole("button", { name: /go to line 4/i }),
  });
  clock.mark("manual-fix");
  await cursor.click(line4Issue.getByRole("button", { name: /enter manually/i }));
  const supplierCode = line4Issue.getByRole("textbox", {
    name: /supplier code/i,
  });
  await required(supplierCode, "manual supplier code input");
  await cursor.type(supplierCode, "ES-WIRE-22BK-100");
  await cursor.click(line4Issue.getByRole("button", { name: /^save$/i }));
  await expect(issues).toHaveAttribute("data-issues", "0");
  await hold("manual-fix");

  clock.mark("validate");
  await required(
    issues.getByText("Ready to send", { exact: true }),
    "supplier readiness",
  );
  await hold("validate");

  clock.mark("preview-output");
  await cursor.click(page.getByRole("button", { name: "Output", exact: true }));
  await cursor.click(page.getByRole("tab", { name: /preview/i }));
  await required(
    page.getByText(/what we.?ll send/i),
    "supplier output preview",
  );
  await hold("preview-output");

  clock.mark("deliver");
  await cursor.click(
    page.getByRole("button", { name: /^send to supplier$/i }),
  );
  const confirmation = page.locator("#confirm-check");
  await required(confirmation, "send confirmation checkbox");
  await cursor.click(confirmation);
  await cursor.click(
    page.getByRole("button", { name: /send to supplier/i }).last(),
  );
  await required(
    page.getByRole("status").filter({ hasText: /delivered to supplier/i }),
    "delivered transmission state",
  );
  await hold("deliver");

  await page.goto("/operations/log", { waitUntil: "networkidle" });
  await required(
    page.getByRole("heading", { name: /delivery log/i }),
    "delivery log",
  );
  clock.mark("audit");
  await hold("audit");

  clock.mark("close");
  await hold("close");

  clock.save(spec);
  await saveFilmVideo(page, spec.id);
});
