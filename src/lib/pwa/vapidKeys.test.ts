import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("writes three key lines to the named file, never overwrites, and prints no key", () => {
  const dir = mkdtempSync(join(tmpdir(), "vapid-"));
  const file = join(dir, "k.txt");
  const run = () => spawnSync(process.execPath, ["scripts/vapid-keys.mjs", file], { encoding: "utf8" });
  try {
    const first = run();
    expect(first.status).toBe(0);
    expect(first.stdout).toBe("Keys written.\n");
    const text = readFileSync(file, "utf8");
    const lines = text.trim().split("\n").map((l) => l.split("="));
    expect(lines.map(([name]) => name)).toEqual(["NEXT_PUBLIC_VAPID_PUBLIC_KEY", "WebPush__PublicKey", "WebPush__PrivateKey"]);
    const [[, pub], [, pub2], [, priv]] = lines;
    expect(pub2).toBe(pub);
    const raw = Buffer.from(pub, "base64url");
    expect(raw).toHaveLength(65);
    expect(raw[0]).toBe(4);
    expect(Buffer.from(priv, "base64url")).toHaveLength(32);
    expect(first.stdout).not.toContain(pub);
    expect(first.stdout).not.toContain(priv);
    expect(run().status).toBe(1);
    expect(readFileSync(file, "utf8")).toBe(text);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
