import { describe, it, expect } from "vitest";
import {
  MAPPER_EVENT,
  buildMapperCommands,
  nextOutputFormat,
  type MapperCommandEvent,
} from "./mapperCommands";

describe("nextOutputFormat — cycles PREVIEW_FORMATS", () => {
  it("advances to the next format, wrapping at the end", () => {
    expect(nextOutputFormat("csv")).toBe("json");
    expect(nextOutputFormat("json")).toBe("xml");
    expect(nextOutputFormat("x12")).toBe("csv"); // wraps
  });
  it("falls back to the first format for an unknown current value", () => {
    // @ts-expect-error — deliberately pass an off-list value to assert the guard.
    expect(nextOutputFormat("totally-made-up")).toBe("csv");
  });
});

describe("buildMapperCommands — palette → mapper event bus", () => {
  const dispatched: MapperCommandEvent[] = [];
  const dispatch = (e: MapperCommandEvent) => dispatched.push(e);
  const cmds = buildMapperCommands(dispatch);

  it("exposes the four mapper power commands with stable ids a13..a16", () => {
    expect(cmds.map((c) => c.id)).toEqual(["a13", "a14", "a15", "a16"]);
    for (const c of cmds) {
      expect(c.group).toBe("Mapper");
      expect(c.label.trim().length).toBeGreaterThan(0);
    }
  });

  it("each command dispatches exactly one typed mapper event", () => {
    const kinds = cmds.map((c) => {
      dispatched.length = 0;
      c.run();
      expect(dispatched).toHaveLength(1);
      return dispatched[0].kind;
    });
    expect(kinds).toEqual([
      "jump-to-field",
      "add-transform",
      "switch-format",
      "show-standards",
    ]);
  });

  it("uses the shared MAPPER_EVENT channel name", () => {
    expect(MAPPER_EVENT).toBe("plk:mapper");
  });
});
