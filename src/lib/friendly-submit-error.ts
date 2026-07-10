// Maps a failed form submission to a plain-language, visitor-safe sentence.
//
// The api-client throws Error instances whose .message is often an INTERNAL
// string — the raw response body (JSON like {"error":"Rate limit exceeded…"}),
// "submitSupportRequest failed: <status>", or "Request timed out after
// 30000ms". Rendering those verbatim on a lead-gen form violates the
// plain-language copy rule, so: use the backend's own .error sentence when the
// body parses as JSON (those are already written for humans), translate
// timeouts, and fall back to a friendly line with the contact email otherwise.
export function friendlySubmitError(err: unknown, contactEmail: string): string {
  const fallback = `Something went wrong sending your request. Please email ${contactEmail} and we'll reply within 1 business day.`;
  if (!(err instanceof Error) || !err.message) return fallback;
  try {
    const parsed: unknown = JSON.parse(err.message);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "error" in parsed &&
      typeof (parsed as { error: unknown }).error === "string"
    ) {
      return (parsed as { error: string }).error;
    }
  } catch {
    // not a JSON body — fall through to the pattern checks
  }
  if (/timed out/i.test(err.message)) {
    return `The request took too long to send. Please try again, or email ${contactEmail}.`;
  }
  return fallback;
}
