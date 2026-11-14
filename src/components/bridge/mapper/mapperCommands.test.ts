import { describe, it, expect } from "vitest";
import {
  MAPPER_EVENT,
  buildMapperCommands,
  type MapperCommandEvent,
} from "./mapperCommands";

describe("buildMapperCommands — palette → mapper event bus", () => {
  const dispatched: MapperCommandEvent[] = [];
  const dispatch = (e: MapperCommandEvent) => dispatched.push(e);
  const cmds = buildMapperCommands(dispatch);

  it("exposes the two mapper power commands with stable ids a13..a14", () => {
    expect(cmds.map((c) => c.id)).toEqual(["a13", "a14"]);
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
    ]);
  });

  it("uses the shared MAPPER_EVENT channel name", () => {
    expect(MAPPER_EVENT).toBe("plk:mapper");
  });
});
