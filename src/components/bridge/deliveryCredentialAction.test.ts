// B8 — the SFTP credential-write decision must NOT silently keep a stale, wrong-shape secret
// when the auth method changes (password ↔ private key).

import { describe, it, expect } from "vitest";
import { decideHttpCredentialAction, decideSftpCredentialAction } from "./deliveryCredentialAction";

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

// ── HTTP / Erply header-style auth ──────────────────────────────────────────────────────────
//
// The SFTP guard above knows the shape it loaded with. The HTTP selector knows nothing: the auth
// type, the API-key header name, the Basic username and every OAuth2 field except the secret are
// all written into the same encrypted record, and the GET response returns none of them. So the
// editor's defaults stood in for saved values, and the old per-type
// `if (!secret && hasSavedCredentials) return null` shortcuts let them through the moment a
// rotation supplied the secret.

const FIELDS = {
  apiKeyHeader: "",
  apiKeyValue: "",
  bearerToken: "",
  basicUsername: "",
  basicPassword: "",
  tokenUrl: "",
  oauthClientId: "",
  oauthClientSecret: "",
};

const withFields = (over: Partial<typeof FIELDS>) => ({ ...FIELDS, ...over });

describe("decideHttpCredentialAction", () => {
  it("keeps the stored credential while the operator has not chosen a type", () => {
    // The shape is unknown. Writing anything here — including `{"type":"none"}` — would replace a
    // credential nobody asked to replace.
    expect(
      decideHttpCredentialAction({
        selected: "none",
        shapeChosen: false,
        hasSavedCredentials: true,
        fields: FIELDS,
      }),
    ).toEqual({ kind: "keep" });
  });

  it("writes freely when there is no saved credential to damage", () => {
    for (const selected of ["none", "apikey", "bearer", "basic", "oauth2"] as const) {
      expect(
        decideHttpCredentialAction({
          selected,
          shapeChosen: true,
          hasSavedCredentials: false,
          fields: FIELDS,
        }),
      ).toEqual({ kind: "replace" });
    }
  });

  it("blocks an API-key rotation that leaves the header unanswered", () => {
    // The corruption verbatim: the secret was supplied, so the old shortcut wrote the record —
    // carrying the DEFAULT header over whatever the supplier actually requires.
    const d = decideHttpCredentialAction({
      selected: "apikey",
      shapeChosen: true,
      hasSavedCredentials: true,
      fields: withFields({ apiKeyValue: "sk_live_rotated" }),
    });
    expect(d.kind).toBe("block");
    expect(d.kind === "block" && d.message).toMatch(/Header/);
  });

  it("blocks an OAuth2 secret rotation that would blank the token URL and client id", () => {
    const d = decideHttpCredentialAction({
      selected: "oauth2",
      shapeChosen: true,
      hasSavedCredentials: true,
      fields: withFields({ oauthClientSecret: "rotated" }),
    });
    expect(d.kind).toBe("block");
    expect(d.kind === "block" && d.message).toMatch(/Token URL and Client ID/);
  });

  it("blocks a Basic rotation that would empty the username", () => {
    const d = decideHttpCredentialAction({
      selected: "basic",
      shapeChosen: true,
      hasSavedCredentials: true,
      fields: withFields({ basicPassword: "rotated" }),
    });
    expect(d.kind).toBe("block");
    expect(d.kind === "block" && d.message).toMatch(/Username/);
  });

  it("allows a complete replacement", () => {
    expect(
      decideHttpCredentialAction({
        selected: "apikey",
        shapeChosen: true,
        hasSavedCredentials: true,
        fields: withFields({ apiKeyHeader: "Authorization", apiKeyValue: "sk_live_rotated" }),
      }),
    ).toEqual({ kind: "replace" });
  });

  it("treats whitespace as blank, so a space cannot pass for a header name", () => {
    const d = decideHttpCredentialAction({
      selected: "apikey",
      shapeChosen: true,
      hasSavedCredentials: true,
      fields: withFields({ apiKeyHeader: "   ", apiKeyValue: "sk" }),
    });
    expect(d.kind).toBe("block");
  });

  it("lets an explicit 'none' remove the stored credential once it is really chosen", () => {
    // Choosing None used to be a silent no-op (the old branch returned null, keeping the
    // credential). Chosen deliberately, it is an instruction and needs no fields.
    expect(
      decideHttpCredentialAction({
        selected: "none",
        shapeChosen: true,
        hasSavedCredentials: true,
        fields: FIELDS,
      }),
    ).toEqual({ kind: "replace" });
  });
});
