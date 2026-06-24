// B8 — the SFTP credential-write decision must NOT silently keep a stale, wrong-shape secret
// when the auth method changes (password ↔ private key).

import { describe, it, expect } from "vitest";
import { decideSftpCredentialAction } from "./deliveryCredentialAction";

describe("decideSftpCredentialAction", () => {
  it("blocks a password→key switch with no new key (the founder bug)", () => {
    const d = decideSftpCredentialAction({
      selected: "key",
      loaded: "password",
      hasNewSecret: false,
      hasSavedCredentials: true,
    });
    expect(d.kind).toBe("block");
    if (d.kind === "block") expect(d.message).toMatch(/private key/i);
  });

  it("blocks a key→password switch with no new password", () => {
    const d = decideSftpCredentialAction({
      selected: "password",
      loaded: "key",
      hasNewSecret: false,
      hasSavedCredentials: true,
    });
    expect(d.kind).toBe("block");
    if (d.kind === "block") expect(d.message).toMatch(/password/i);
  });

  it("replaces when a new secret IS entered for the switched method (no block)", () => {
    expect(
      decideSftpCredentialAction({ selected: "key", loaded: "password", hasNewSecret: true, hasSavedCredentials: true }),
    ).toEqual({ kind: "replace" });
  });

  it("keeps the stored secret when re-saving the SAME shape with no new secret", () => {
    // The documented "re-save without re-entering the secret" must still work.
    expect(
      decideSftpCredentialAction({ selected: "password", loaded: "password", hasNewSecret: false, hasSavedCredentials: true }),
    ).toEqual({ kind: "keep" });
    expect(
      decideSftpCredentialAction({ selected: "key", loaded: "key", hasNewSecret: false, hasSavedCredentials: true }),
    ).toEqual({ kind: "keep" });
  });

  it("replaces (never blocks) when there is no saved credential yet — a brand-new supplier", () => {
    expect(
      decideSftpCredentialAction({ selected: "key", loaded: null, hasNewSecret: false, hasSavedCredentials: false }),
    ).toEqual({ kind: "replace" });
    // hasSavedCredentials false even if loaded somehow non-null → still nothing to keep.
    expect(
      decideSftpCredentialAction({ selected: "key", loaded: "password", hasNewSecret: false, hasSavedCredentials: false }),
    ).toEqual({ kind: "replace" });
  });
});
