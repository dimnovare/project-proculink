import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import de from "../../../../messages/de.json";
import GuideLayout from "./GuideLayout";
import { Step, Prereqs, IfThisFails, Outcome } from "./Step";
import { GuideShot } from "./GuideShot";
import { START_HERE, getGuideBySlug, liveClientGuides, type Guide } from "@/lib/guides";

const capture = vi.fn();
vi.mock("@/lib/analytics", () => ({ capture: (...a: unknown[]) => capture(...a) }));

// A manifest with exactly one captured shot, so both branches of <GuideShot>
// are exercised against the same guide.
vi.mock("@/lib/guide-shots.generated", () => ({
  GUIDE_SHOTS: {
    "receive-documents-by-email/settings-email-intake": { w: 2360, h: 1640 },
  },
}));

const clientGuide = getGuideBySlug("receive-documents-by-email") as Guide;
const adminGuide = getGuideBySlug("onboard-a-new-client") as Guide;

function renderGuide(guide: Guide) {
  return render(
    <GuideLayout guide={guide}>
      <Prereqs>
        <ul>
          <li>An account</li>
        </ul>
      </Prereqs>
      <Step n={1} title="Copy the address">
        <p>Body of step one.</p>
        <IfThisFails>
          <p>Check the slug.</p>
        </IfThisFails>
      </Step>
      <Step n={2} title="Send a test order">
        <p>Body of step two.</p>
        <Outcome>
          <p>It arrived.</p>
        </Outcome>
      </Step>
    </GuideLayout>,
  );
}

beforeEach(() => {
  capture.mockReset();
});

describe("GuideLayout", () => {
  it("renders the registry title, blurb, and step count", () => {
    renderGuide(clientGuide);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(clientGuide.title);
    expect(screen.getByText(clientGuide.blurb)).toBeInTheDocument();
    // The count comes from the rendered steps, not from the registry.
    expect(screen.getByText(clientGuide.minutes != null ? `About ${clientGuide.minutes} minutes, 2 steps` : "2 steps")).toBeInTheDocument();
  });

  it("builds the desktop step list from the rendered steps, not from a registry", () => {
    renderGuide(clientGuide);
    const nav = screen.getByRole("navigation", { name: "Guide steps" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((a) => a.textContent)).toEqual([
      "Copy the address",
      "Send a test order",
    ]);
    expect(links[0]).toHaveAttribute("href", "#step-1");
    expect(links[1]).toHaveAttribute("href", "#step-2");
  });

  it("gives each step a deep-linkable anchor and a numbered heading", () => {
    renderGuide(clientGuide);
    const step = document.getElementById("step-2");
    expect(step).not.toBeNull();
    expect(step).toHaveAttribute("data-step-title", "Send a test order");
    expect(screen.getByRole("heading", { level: 2, name: /Send a test order/ })).toBeInTheDocument();
  });

  it("renders the client footer: feedback, reference articles, support", () => {
    renderGuide(clientGuide);
    expect(screen.getByText("Did this guide get you there?")).toBeInTheDocument();
    expect(screen.getByText("Reference articles")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Contact support/ })).toBeInTheDocument();
    expect(screen.queryByText("Internal runbook")).not.toBeInTheDocument();
  });

  it("offers the next Start here guide and only on the first two", () => {
    const one = (g: Guide) =>
      render(
        <GuideLayout guide={g}>
          <Step n={1} title="Only step">
            <p>x</p>
          </Step>
        </GuideLayout>,
      );
    const next = getGuideBySlug(START_HERE[1])!;
    const first = one(getGuideBySlug(START_HERE[0])!);
    expect(screen.getByText("Next guide, 2 of 3")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: new RegExp(next.title) })).toHaveAttribute("href", next.href);
    first.unmount();
    const last = one(getGuideBySlug(START_HERE[2])!);
    expect(screen.queryByText(/^Next guide/)).toBeNull();
    last.unmount();
    one(liveClientGuides().find((g) => !START_HERE.includes(g.slug))!);
    expect(screen.queryByText(/^Next guide/)).toBeNull();
    expect(screen.getByRole("link", { name: "All step-by-step guides" })).toHaveAttribute("href", "/help/guides");
  });
  it("captures a guide_opened event for a client guide", () => {
    renderGuide(clientGuide);
    expect(capture).toHaveBeenCalledWith("guide_opened", {
      slug: clientGuide.slug,
      section: clientGuide.section,
    });
  });

  it("marks an admin guide internal, drops the public chrome, and stays out of analytics", () => {
    renderGuide(adminGuide);
    expect(screen.getByText("Internal · admins only")).toBeInTheDocument();
    expect(screen.getByText("Internal runbook")).toBeInTheDocument();
    expect(screen.queryByText("Did this guide get you there?")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Help centre" })).not.toBeInTheDocument();
    expect(capture).not.toHaveBeenCalled();
  });
});

describe("guide callouts", () => {
  it("labels the prerequisite box and the failure branch", () => {
    renderGuide(clientGuide);
    expect(screen.getByRole("complementary", { name: "You'll need" })).toBeInTheDocument();
    expect(screen.getByText("If this fails")).toBeInTheDocument();
    expect(screen.getByText("Check the slug.")).toBeInTheDocument();
    expect(screen.getByText("It arrived.")).toBeInTheDocument();
  });

  it("translates both callout headings, leaving the guide body English", () => {
    render(
      <NextIntlClientProvider locale="de" messages={de}>
        <Step n={1} title="Copy the address">
          <Prereqs>An account</Prereqs>
          <IfThisFails>Check the slug.</IfThisFails>
        </Step>
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("complementary", { name: "Das brauchen Sie" })).toBeInTheDocument();
    expect(screen.getByText("Wenn es nicht klappt")).toBeInTheDocument();
    expect(screen.getByText("Check the slug.")).toBeInTheDocument();
  });
});

describe("GuideShot", () => {
  function renderShot(name: string) {
    return render(
      <GuideLayout guide={clientGuide}>
        <Step n={1} title="Only step">
          <GuideShot name={name} alt="What the reader should look for" />
        </Step>
      </GuideLayout>,
    );
  }

  it("renders a real image with intrinsic dimensions when the shot is captured", () => {
    renderShot("settings-email-intake");
    const img = screen.getByRole("img", { name: "What the reader should look for" });
    expect(img).toHaveAttribute("src", "/guides/receive-documents-by-email/settings-email-intake.png");
    expect(img).toHaveAttribute("width", "2360");
    expect(img).toHaveAttribute("height", "1640");
  });

  it("never renders a broken image for a shot that has not been captured", () => {
    renderShot("not-captured-yet");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    // In development the slot is visible so the author can see what is missing.
    expect(screen.getByText("Screenshot not captured")).toBeInTheDocument();
    expect(
      screen.getByText("public/guides/receive-documents-by-email/not-captured-yet.png"),
    ).toBeInTheDocument();
  });
});
