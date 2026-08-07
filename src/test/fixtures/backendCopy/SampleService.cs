// A FIXTURE, not backend code. src/test/backendCopyVocabulary.test.ts runs the real
// scanner over this file on every run, everywhere, so that a green scan against the actual
// backend means the reader and the filter still work.
//
// Every construct here is one the real corpus contains and one a naive scanner gets wrong:
// a `+`-joined const, an interpolation whose hole contains a string literal of its own, a
// structured log template, a char literal holding a quote, and a comment quoting a banned
// word. The assertions live in the test; this file just has to keep containing them.

namespace ProcuLink.Fixture;

public sealed class SampleService
{
    // A banned word in a commented-out sentence: "the artifact was dead-lettered".
    // A reader that collected comments would report a message the service does not write.

    public void Fail()
    {
        // Two literals joined by `+`. A matcher for a phrase spanning the join finds
        // nothing unless the run is read as one sentence.
        const string parked =
            "This order is in dead-letter state, "
          + "so nothing further will be attempted.";

        // An interpolation whose hole contains `", "` — the exact shape that ends the
        // string early for any naive scanner and yields two fragments instead of one.
        var unresolved = $"Cannot transform: lines {string.Join(", ", Numbers)} still need review.";

        // A structured log template. Its holes keep their PascalCase names because the
        // string is not interpolated, which is how the filter tells it from operator copy.
        _logger.LogWarning("Order {OrderId} moved to dead-letter after {Attempts} artifact sends.", Id, Count);

        // A char literal holding a quote. It must not open a string.
        var quote = '"';

        // Short, code-shaped, and a URL — none of these is a sentence.
        var status = "delivery_dead_letter";
        var mime = "application/json";
        var docs = "https://example.invalid/artifact";

        Report(parked, unresolved, quote, status, mime, docs);
    }
}
