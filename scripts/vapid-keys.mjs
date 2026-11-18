// Makes a VAPID key pair for phone alerts and writes it to a new file, never to the screen.
// Usage: bun scripts/vapid-keys.mjs <file>
import { generateKeyPairSync } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("Usage: bun scripts/vapid-keys.mjs <file>");
  process.exit(1);
}
if (existsSync(file)) {
  console.error("That file already exists; pick a new one.");
  process.exit(1);
}
const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const pub = publicKey.export({ format: "jwk" });
const pubKey = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, "base64url"), Buffer.from(pub.y, "base64url")]).toString("base64url");
const privKey = privateKey.export({ format: "jwk" }).d;
writeFileSync(file, `NEXT_PUBLIC_VAPID_PUBLIC_KEY=${pubKey}\nWebPush__PublicKey=${pubKey}\nWebPush__PrivateKey=${privKey}\n`, { flag: "wx", mode: 0o600 });
console.log("Keys written.");
