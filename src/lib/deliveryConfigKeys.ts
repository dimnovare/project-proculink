import type { DeliveryProtocol } from "@/lib/api/types";

/**
 * Every config key this editor MANAGES, per protocol — exactly the set `buildManagedConfigObject()`
 * can emit, including the ones it emits conditionally.
 *
 * The save replaces the whole config object (the backend assigns `request.ConfigJson` wholesale and
 * only checks that it parses), so this list decides two things at once:
 *
 *  - a key that IS here can be genuinely cleared — blanking the reply-to address removes it;
 *  - a key that is NOT here is a per-supplier setting this editor has no field for, and is carried
 *    through the save untouched instead of being deleted by it.
 *
 * That second half is not theoretical. `headers` (custom HTTP request headers, injected into every
 * outbound request) and `fromAddress` on the EMAIL protocol (the supplier's verified sender — the
 * From input is inside the smtp-only branch, so email has no field for it at all) are both live on
 * the wire and were both destroyed by any save on this screen.
 *
 * Adding a field to this editor means adding its key here.
 */
export const MANAGED_CONFIG_KEYS: Record<DeliveryProtocol, readonly string[]> = {
  manual: [],
  http: ["url", "method", "timeoutSeconds"],
  sftp: ["host", "port", "remotePath", "makeDirectories", "overwriteExisting", "timeoutSeconds"],
  ftps: [
    "host",
    "port",
    "remotePath",
    "makeDirectories",
    "overwriteExisting",
    "timeoutSeconds",
    "allowInvalidCertificate",
  ],
  email: ["toAddresses", "replyTo", "subjectTemplate", "bodyTemplate", "attachmentFileName"],
  smtp: [
    "host",
    "port",
    "useSsl",
    "fromAddress",
    "toAddresses",
    "timeoutSeconds",
    "subjectTemplate",
    "bodyTemplate",
    "attachmentFileName",
  ],
  erp_erply: ["url", "clientCode", "timeoutSeconds"],
  erp_directo: ["url", "database", "timeoutSeconds"],
  s3: ["bucket", "prefix", "region", "serviceUrl", "accessKeyId"],
};
