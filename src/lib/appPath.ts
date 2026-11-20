/**
 * A same-site path, safe to go back to: the same check as GoogleConnectService.Start — a path with no
 * control character (C# `char.IsControl` is `\p{Cc}`). A URL parser drops tabs, so "/\t/host" means "//host".
 */
export function isAppPath(p: string): boolean {
  return p.startsWith("/") && !p.startsWith("//") && !p.startsWith("/\\") && !/\p{Cc}/u.test(p);
}
