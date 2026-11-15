import { describe, expect, it } from "vitest";
import { destinationWhere, destinationsAddress, lastSendWords, readDestinationsAddress, sendMoment, usedByWords } from "./destinations";

const where = (protocol: string, config: Record<string, unknown>) => destinationWhere({ protocol, config });

describe("destination words", () => {
  it("says where a destination sends from the keys it knows, and nothing else", () => {
    const said = [
      where("sftp", { host: "sftp.example.test", remotePath: "/in/invoices", port: 22 }),
      where("ftps", { host: "ftp.example.test" }),
      where("email", { toAddresses: "ap@example.test, books@example.test" }),
      where("http", { url: "https://alex:pw-123@erp.example.test/documents/?token=tok-456#top", headers: { Authorization: "Bearer tok-789" } }),
      where("http", { url: "not an address" }),
      where("s3", { bucket: "invoices", prefix: "in/", accessKeyId: "AKIAEXAMPLE", region: "eu-north-1" }),
      where("google_drive", { accountId: "acc-1", folderId: "f-1", folderName: "Invoices 2026" }),
      where("google_sheets", { spreadsheetName: "Invoice log", sheetName: "Sheet1" }),
      where("google_sheets", { spreadsheetId: "s-1" }),
      where("carrier_pigeon", { secret: "pw-000" }),
    ];
    expect(said).toEqual([
      "SFTP, sftp.example.test, folder /in/invoices",
      "FTPS, ftp.example.test",
      "Email to ap@example.test, books@example.test",
      "Web address, erp.example.test/documents",
      "Web address",
      "S3 bucket, invoices, folder in/",
      "Google Drive, folder Invoices 2026",
      "Google Sheets, Invoice log, tab Sheet1",
      "Google Sheets",
      "carrier_pigeon",
    ]);
    for (const s of said) expect(s).not.toMatch(/undefined|null|pw-|tok-|AKIA|alex|eu-north|acc-1|s-1/);
  });

  it("words a last send and reads only an address it understands", () => {
    const now = new Date(2026, 5, 1, 15, 0);
    const at = (y: number, m: number, d: number, h: number, mi: number) => new Date(y, m, d, h, mi).toISOString();
    expect([at(2026, 5, 1, 14, 5), at(2026, 4, 31, 23, 50), at(2026, 4, 12, 9, 0), at(2025, 10, 12, 9, 0)].map((i) => sendMoment(i, now)))
      .toEqual(["at 14:05", "yesterday", "on 12 May", "on 12 November 2025"]);
    expect(sendMoment("nonsense", now)).toBeNull();
    expect(lastSendWords({ kind: "document", at: at(2026, 5, 1, 8, 2), ok: true }, now)).toEqual({ text: "Sent at 08:02", tone: "ok" });
    expect(lastSendWords({ kind: "document", at: at(2026, 4, 24, 9, 10), ok: false }, now)).toEqual({ text: "Couldn't send on 24 May", tone: "failed" });
    expect(lastSendWords({ kind: "test", at: at(2026, 5, 1, 14, 5), ok: true }, now)).toEqual({ text: "Test arrived at 14:05", tone: "ok" });
    expect(lastSendWords({ kind: "test", at: at(2026, 4, 31, 9, 0), ok: false }, now)).toEqual({ text: "Test failed yesterday", tone: "failed" });
    expect(lastSendWords({ kind: "replay", at: at(2026, 5, 1, 14, 5), ok: true }, now)).toEqual({ text: "Last used at 14:05", tone: "never" });
    expect(lastSendWords(null, now)).toEqual({ text: "Never sent", tone: "never" });
    expect([0, 1, 2].map(usedByWords)).toEqual(["Not used", "1 output", "2 outputs"]);
    expect([destinationsAddress(), destinationsAddress("dest-1"), destinationsAddress("new")])
      .toEqual(["/settings?tab=destinations", "/settings?tab=destinations&open=dest-1", "/settings?tab=destinations&open=new"]);
    const open = (q: string) => readDestinationsAddress(new URLSearchParams(q)).open;
    expect([open("tab=destinations&open=dest-1"), open("open=new")]).toEqual(["dest-1", "new"]);
    expect([open(""), open("open="), open("open=a&open=b"), open("open=%3Cb%3E"), open(`open=${"x".repeat(65)}`)]).toEqual([null, null, null, null, null]);
  });
});
