import { expect, test } from "@playwright/test";
import { Buffer } from "node:buffer";
import {
  FilmClock,
  FilmCursor,
  narrationBudgets,
  prepareFilmPage,
  required,
  saveFilmVideo,
} from "./capture-helpers";
import { loadFilmSpec } from "./film-spec";

const SAMPLE_CSV =
  "po_number,buyer_name,line_no,item_code,description,quantity,unit_price,currency\n" +
  "PO-2026-004417,Nordic Electronics,1,TB-CAP-100,Capacitor 100uF,200,0.35,EUR\n" +
  "PO-2026-004417,Nordic Electronics,2,TB-RES-220,Resistor 220R,500,0.02,EUR\n" +
  "PO-2026-004417,Nordic Electronics,3,TB-WIRE-22,Wire 22AWG Black 100m,5,12.50,EUR\n";

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

  clock.mark("import");
  const chooserPromise = page.waitForEvent("filechooser");
  await cursor.click(page.getByRole("button", { name: /browse files/i }));
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: "PO-2026-004417.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(SAMPLE_CSV),
  });
  await required(page.getByText(/detected:/i), "detected format");
  await hold("import");

  clock.mark("detect");
  await required(page.getByText(/detected:/i), "detected format state");
  await hold("detect");

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
