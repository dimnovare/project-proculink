import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

const replace = vi.fn();
let engine: "on" | "off" | "unknown" = "on";
vi.mock("next/navigation", () => ({ usePathname: () => "/bridge", useRouter: () => ({ replace }) }));
vi.mock("@/hooks/useDocumentEngine", () => ({ useDocumentEngine: () => engine }));

import { EngineRouteRedirect } from "./EngineRouteRedirect";

describe("EngineRouteRedirect", () => {
  beforeEach(() => replace.mockClear());

  it("moves an engine-on org off an old route, once", () => {
    engine = "on";
    render(<EngineRouteRedirect />);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("/documents");
  });

  it.each(["unknown", "off"] as const)("never moves an org whose engine reads %s", (e) => {
    engine = e;
    render(<EngineRouteRedirect />);
    expect(replace).not.toHaveBeenCalled();
  });
});
