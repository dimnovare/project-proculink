import { expect, it } from "vitest";
import { MAX_UPLOAD_BYTES } from "@/lib/fileKinds";
import { canHoldMore, HELD_MAX_BYTES, HeldRefusal, heldStore } from "./heldUploads";

it("keeps at most 10 files and 50 MB, and says why in words", () => {
  const f = (bytes: number) => new File([new Uint8Array(bytes)], "x.pdf");
  const nine = Array.from({ length: 9 }, () => ({ file: f(1) }));
  expect(canHoldMore(nine, f(1))).toBeNull();
  expect(canHoldMore([...nine, { file: f(1) }], f(1))?.code).toBe("held_limit");
  expect(canHoldMore([{ file: f(HELD_MAX_BYTES - 10) }], f(11))?.code).toBe("held_limit");
  expect(HELD_MAX_BYTES).toBe(5 * MAX_UPLOAD_BYTES);
  expect(new HeldRefusal("held_limit").message).toBe("This device can keep up to 10 files, 50 MB in all, until you're back online. Add this one again once those have gone up.");
  expect(new HeldRefusal("held_unavailable").message).toBe("You're offline, and this browser can't keep the file until you're back. Add it again when you're online.");
  expect(new HeldRefusal("held_no_room").message).toBe("This device has no room to keep the file until you're back online. Add it again when you're online.");
  expect(heldStore()).toBeNull(); // jsdom has no IndexedDB or Web Locks: the store says so instead of pretending
});
