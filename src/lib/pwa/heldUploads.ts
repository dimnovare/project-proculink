import { MAX_UPLOAD_BYTES } from "@/lib/fileKinds";

/**
 * Files chosen while offline, kept on this device until the connection returns.
 * Bytes live only in IndexedDB, never in localStorage. Each record is bound to the
 * person, workspace and flow it was chosen for; the upload queue checks that binding
 * before every send. A Web Lock per record makes one tab its owner.
 */
export interface HeldRecord { key: string; userId: string; orgId: string; flowId: string; flowName: string; file: File; heldAt: string }

export interface HeldStore {
  all(): Promise<HeldRecord[]>;
  /** Rejects on quota or a refused write. */
  put(record: HeldRecord): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
  /** Takes the Web Lock "plk-held:<key>" if free and keeps it until release() or the tab closes. Gone or busy: null. */
  claim(key: string): Promise<(() => void) | null>;
}

export const HELD_MAX_FILES = 10;
export const HELD_MAX_BYTES = 5 * MAX_UPLOAD_BYTES;

export type HeldRefusalCode = "held_limit" | "held_unavailable" | "held_no_room";

const COPY: Record<HeldRefusalCode, string> = {
  held_limit: `This device can keep up to ${HELD_MAX_FILES} files, ${HELD_MAX_BYTES / 1024 / 1024} MB in all, until you're back online. Add this one again once those have gone up.`,
  held_unavailable: "You're offline, and this browser can't keep the file until you're back. Add it again when you're online.",
  held_no_room: "This device has no room to keep the file until you're back online. Add it again when you're online.",
};

/** An Error whose message is the sentence the person reads. */
export class HeldRefusal extends Error {
  readonly code: HeldRefusalCode;
  constructor(code: HeldRefusalCode) {
    super(COPY[code]);
    this.name = "HeldRefusal";
    this.code = code;
  }
}

/** null when the device may keep `file` beside `records`; otherwise the "held_limit" refusal. */
export function canHoldMore(records: readonly Pick<HeldRecord, "file">[], file: File): HeldRefusal | null {
  const bytes = records.reduce((sum, r) => sum + r.file.size, file.size);
  return records.length >= HELD_MAX_FILES || bytes > HELD_MAX_BYTES ? new HeldRefusal("held_limit") : null;
}

const DB_NAME = "plk-device";
const STORE = "held-uploads";
let instance: HeldStore | null | undefined;

/** The device store, or null when this browser has no IndexedDB or Web Locks. One instance per page. */
export function heldStore(): HeldStore | null {
  if (instance !== undefined) return instance;
  if (typeof indexedDB === "undefined" || typeof navigator === "undefined" || !navigator.locks) return (instance = null);

  let opening: Promise<IDBDatabase> | undefined;
  const open = () =>
    (opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "key" });
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }).catch((e) => {
      opening = undefined;
      throw e;
    }));

  /** One request in its own transaction, settled when the transaction commits (a refused write rejects). */
  const run = async <T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const r = op(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(r.result);
      tx.onerror = tx.onabort = () => reject(tx.error ?? r.error);
    });
  };

  return (instance = {
    all: () => run("readonly", (s) => s.getAll() as IDBRequest<HeldRecord[]>),
    put: async (record) => void (await run("readwrite", (s) => s.put(record))),
    remove: async (key) => void (await run("readwrite", (s) => s.delete(key))),
    clear: async () => void (await run("readwrite", (s) => s.clear())),
    claim: async (key) => {
      let release = () => {};
      const taken = await new Promise<boolean>((resolve) => {
        navigator.locks
          .request(`plk-held:${key}`, { ifAvailable: true }, (lock) => {
            resolve(lock !== null);
            return lock ? new Promise<void>((r) => (release = r)) : null;
          })
          .catch(() => resolve(false));
      });
      if (!taken) return null;
      const still = await run("readonly", (s) => s.get(key)).catch(() => undefined);
      if (!still) {
        release();
        return null;
      }
      return release;
    },
  });
}

/** For sign-out: how many files this device holds (0 without a store or when it cannot be read). */
export async function heldCount(): Promise<number> {
  return (await heldStore()?.all().catch(() => []))?.length ?? 0;
}

/** For sign-out: removes every held file on this device. A store that cannot be reached leaves nothing to remove. */
export async function clearHeldUploads(): Promise<void> {
  await heldStore()?.clear().catch(() => {});
}
