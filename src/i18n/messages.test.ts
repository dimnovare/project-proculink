import { describe, expect, it } from "vitest";
import de from "../../messages/de.json";
import en from "../../messages/en.json";
import et from "../../messages/et.json";
import fr from "../../messages/fr.json";
import pl from "../../messages/pl.json";

/** Every translated string by its dotted key, with the {placeholders} it uses. */
const flat = (o: object, at = ""): Record<string, string> =>
  Object.entries(o).reduce<Record<string, string>>((acc, [k, v]) => {
    const key = at ? `${at}.${k}` : k;
    if (typeof v === "string") acc[key] = [...v.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
    else Object.assign(acc, Array.isArray(v) ? { [key]: `list:${v.length}` } : flat(v, key));
    return acc;
  }, {});

describe("messages", () => {
  it("every language has the same keys, placeholders and list lengths; English lives in the source", () => {
    expect(en).toEqual({});
    const reference = flat(de);
    // Measured 662 on 2026-11-28; a big drop means a namespace was lost.
    expect(Object.keys(reference).length).toBeGreaterThan(600);
    for (const [name, messages] of Object.entries({ fr, pl, et })) expect(flat(messages), name).toEqual(reference);
  });
});
