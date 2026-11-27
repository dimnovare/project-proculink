import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import de from "../../../messages/de.json";
import { LanguageList, LanguageMenuButton } from "./LanguageSwitcher";

vi.mock("next/navigation", () => ({ usePathname: () => "/pricing" }));

describe("language switcher", () => {
  afterEach(() => {
    document.cookie = "NEXT_LOCALE=; path=/; max-age=0";
  });

  it("lists the five languages by their own names, marks the current one and saves the choice", () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    render(
      <NextIntlClientProvider locale="de" messages={de}>
        <LanguageMenuButton />
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Sprache: Deutsch" }));
    expect(screen.getAllByRole("button").slice(1).map((b) => b.textContent)).toEqual(["English", "Deutsch", "Français", "Polski", "Eesti"]);
    expect(screen.getByRole("button", { name: "Deutsch" })).toHaveAttribute("aria-current", "true");
    fireEvent.click(screen.getByRole("button", { name: "Polski" }));
    expect(document.cookie).toContain("NEXT_LOCALE=pl");
    expect(reload).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("renders English with no provider, as every bare unit test does", () => {
    render(<LanguageList variant="footer" />);
    expect(screen.getByRole("link", { name: "English" })).toHaveAttribute("aria-current", "true");
  });
});
