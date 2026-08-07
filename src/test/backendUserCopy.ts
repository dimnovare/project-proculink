// The backend sentences that reach an operator's screen, and the rule they are held to.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS EXISTS
//
// `scripts/check-vocabulary.mjs` bans the retired Bridge-Layer metaphor and engine jargon
// from user-facing copy. It walks FRONTEND SOURCE ONLY, which was correct while the
// frontend wrote all the copy.
//
// It does not. `src/components/bridge/problem/OrderProblemPanel.tsx:227-230` builds the
// operator's explanation from `[rejectionReason, attemptMessage, ctx.serverMessage]` and
// renders it at `:289-305`. `ctx.serverMessage` is `order.errorMessage` (`:189`), composed
// in C# in another repo. The one function between the wire and the DOM,
// `supplierReasonText`, strips markup and clamps length — a plain English sentence is
// returned UNCHANGED (`supplierReasonText.ts:71`). So a backend sentence is printed
// verbatim, and every word in it is invisible to the rule that bans those words.
//
// The cause matchers do not save it either: `withTransformCause`
// (`problemCopy.ts:589-605`) overrides `attribution`/`consequence`/`helper`/`actions`/
// `tier`/`automaticFor`, and `detail` is not among them — it is not part of `ProblemCopy`
// at all. Every matcher in that file is match-and-AUGMENT. `problemCopy.ts:291-292` says
// so: "The verbatim server message is rendered in its own block ABOVE these lines".
//
// ─────────────────────────────────────────────────────────────────────────────
// THE RENDER PATH, VERIFIED HOP BY HOP
//
// `OrderDto.ErrorMessage` is NOT a column. `PurchaseOrderEntity` has no `ErrorMessage`,
// and `order.ErrorMessage = …` appears nowhere in the backend. It is DERIVED at read time
// in exactly one place — `OrdersController.Get()` — from four reservoirs:
//
//   OrdersController.cs:513-517  newest audit event whose Action is one of
//                                ParseFailed | TransformFailed | DeliveryFailed | DeliveryDeadLettered
//   OrdersController.cs:528-529  …its payload key "error"                     → errorMessage
//   OrdersController.cs:530-531  …or "lastError" (the dead-letter payload)    → errorMessage
//   OrdersController.cs:567      DeliveryAttempt.ErrorMessage                 → errorMessage
//   OrdersController.cs:572-574  DeliveryAttempt.RejectionReason ?? ResponseBody ?? ErrorMessage
//   OrdersController.cs:599 → :2790   MapToDto(entity, errorMessage, …) → `ErrorMessage: errorMessage`
//
// and the transform half of that, end to end:
//
//   TransformValidationException.cs:26/65/67   the sentence is the exception's Message
//   OrderTransformService.cs:728               catch (… is TransformTemplateException or TransformValidationException)
//   OrderTransformService.cs:746               FailTransformAsync(…, ex.Message, …)
//   OrderTransformService.cs:917-921           BuildAuditEvent(…, "TransformFailed", new { error, stage })
//   OrdersController.cs:515 → :529 → :2790     → OrderDto.ErrorMessage
//   OrderProblemPanel.tsx:189 → :227-230 → :289-305   → the operator's screen
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY A `grep` CANNOT DO THIS JOB
//
// The messages are written four different ways — a `const string` split across two
// `+`-concatenated literals, `$"…{hole}…"` interpolations, bare literals in ternary
// branches, and wrappers ending in `: {ex.Message}` — and an interpolation hole may contain
// a string literal of its own, so `$"lines {string.Join(", ", numbers)} still need review."`
// ends at the `", "` for any naive scanner. `src/test/csLiterals.ts` reads them properly.
// See its header.

import { readFileSync } from "fs";
import { join } from "path";

import { lineOf, parseCsStringExpressionsWithOffsets } from "./csLiterals";
import { TIERS, termPattern } from "../../scripts/lib/vocabularyTerms.mjs";

/** One backend file whose string literals can reach an operator's screen. */
export interface UserFacingSource {
  /** Path relative to the backend repo root. */
  readonly file: string;
  /** The DTO field the sentence arrives in. */
  readonly carrier: string;
  /** The hop that gets it there. Prose, but every claim in it is checkable. */
  readonly why: string;
}

/**
 * THE CORPUS — backend files whose sentences can be printed to an operator.
 *
 * Every entry earns its place by a NAMED HOP into one of three carriers, all of which are
 * rendered as visible text with no frontend copy substituted:
 *
 *   OrderDto.ErrorMessage        OrderProblemPanel.tsx:289-305 (also ExceptionDetail.tsx:226,
 *                                OrderDetailsDrawer.tsx:193, useOrderReview.ts:76)
 *   OrderExceptionDto.Message    ExceptionDetail.tsx:160, rendered RAW
 *   a 4xx `error` body           ApiHttpError.message → OrderProblemPanel.tsx:233 → :344
 *
 * WHAT IS DELIBERATELY NOT HERE, and why — silence would overstate the coverage:
 *
 *   • Any file whose only English is an ILogger message template. Those are excluded per
 *     LITERAL by `isOperatorSentence` rather than per file, because the same file usually
 *     holds both (DeliveryService.cs has 25 operator sentences and ~90 log lines).
 *   • `OrderLineDto.ReviewReason` (OrderIngestionService.ComposeReviewReason,
 *     DateParsing/NumberParsing.BuildAmbiguityReason). It reaches the review UI, but through
 *     a different screen with its own copy rules; widening to it is a deliberate second
 *     packet, not something to fold in silently.
 *   • `PassportTimelineEvent.Detail` (PassportService.cs:220) serialises the WHOLE audit
 *     payload as JSON text — including the `detail` key holding a raw `ex.Message`. That is
 *     an integrator surface showing a JSON blob, not operator prose, and holding a .NET
 *     exception message to a copy vocabulary would be a rule nothing can satisfy.
 *   • `GET /api/audit` returns payloads raw (AuditController.cs:78) but the frontend renders
 *     none of it as visible text: `/operations/log` maps backend actions through
 *     `auditActionLabel` and its `c.message` appears only in the search haystack and the CSV
 *     export (CrossingsLog.tsx:556, :1153).
 *   • Every OTHER controller's 4xx bodies. They reach `ApiHttpError.message` and do render,
 *     so they are the obvious next widening — but the panel this finding is about is fed by
 *     OrdersController, and a corpus is only useful if the list it produces is reviewable.
 *   • `ResponseBody` (OrdersController.cs:573) is the SUPPLIER's bytes, not ProcuLink's
 *     copy. Nothing in this repo's vocabulary can be asked of a third party.
 */
export const USER_FACING_SOURCES: readonly UserFacingSource[] = [
  // ── Audit `error` / `lastError` payload writers ──────────────────────────────
  {
    file: "ProcuLink.Api/Services/Orders/OrderIngestionService.cs",
    carrier: "OrderDto.ErrorMessage",
    why: "Writes the ParseFailed audit event whose `error` key OrdersController.cs:529 reads (:913, :982, :1002).",
  },
  {
    file: "ProcuLink.Api/Services/ParseFailureExplain.cs",
    carrier: "OrderDto.ErrorMessage",
    why: "Composes the sentence that becomes that ParseFailed `error` value — its entire purpose.",
  },
  {
    file: "ProcuLink.Api/Services/Orders/OrderTransformService.cs",
    carrier: "OrderDto.ErrorMessage",
    why: "FailTransformAsync writes the TransformFailed audit `error` (:917, :1024); also composes its own wrapper sentences at :663, :699, :720.",
  },
  {
    file: "ProcuLink.Infrastructure/Services/DeliveryService.cs",
    carrier: "OrderDto.ErrorMessage",
    why: "Writes DeliveryAttempt.ErrorMessage (:569, :888, :990, :1018), RejectionReason (:991, :1019) and the DeliveryDeadLettered `lastError` payload (:1795).",
  },

  // ── Exceptions whose .Message becomes the TransformFailed `error` ───────────
  {
    file: "ProcuLink.Transform/Output/TransformValidationException.cs",
    carrier: "OrderDto.ErrorMessage",
    why: "Its Message is caught at OrderTransformService.cs:728 and passed to FailTransformAsync at :746.",
  },
  {
    file: "ProcuLink.Transform/Output/ScribanTemplateTransformService.cs",
    carrier: "OrderDto.ErrorMessage",
    why: "Declares TransformTemplateException (:183) and throws it (:148); same catch at OrderTransformService.cs:728.",
  },
  {
    file: "ProcuLink.Transform/Output/OutputFieldValidator.cs",
    carrier: "OrderDto.ErrorMessage",
    why: "Per-line LineProblem.Message text (:70-95); TransformValidationException.BuildMessage:65 joins those into the sentence.",
  },
  {
    file: "ProcuLink.Transform/Output/X12Sanitizer.cs",
    carrier: "OrderDto.ErrorMessage",
    why: "Delimiter-contamination LineProblem.Message text (:102-105), same join.",
  },
  {
    file: "ProcuLink.Transform/Output/MappedTransformService.cs",
    carrier: "OrderDto.ErrorMessage",
    why: "Overflow LineProblem.Message text (:645) and two TransformValidationException throws (:622, :662).",
  },
  {
    file: "ProcuLink.Transform/Output/OutputTemplateEmitter.cs",
    carrier: "OrderDto.ErrorMessage",
    why: "Throws TransformValidationException (:489).",
  },
  {
    file: "ProcuLink.Transform/Output/XmlTransformService.cs",
    carrier: "OrderDto.ErrorMessage",
    why: "Throws TransformValidationException (:95).",
  },
  {
    file: "ProcuLink.Transform/Output/JsonTransformService.cs",
    carrier: "OrderDto.ErrorMessage",
    why: "Throws TransformValidationException (:105).",
  },
  {
    file: "ProcuLink.Transform/Output/CsvTransformService.cs",
    carrier: "OrderDto.ErrorMessage",
    why: "Throws TransformValidationException (:122).",
  },

  // ── Delivery-attempt message composers ──────────────────────────────────────
  {
    file: "ProcuLink.Core/Services/Delivery/SupplierResponseClassification.cs",
    carrier: "OrderDto.ErrorMessage",
    why: "NamedCauses (:177-209) is a table of literal operator sentences; DescribeFailure (:382) returns one and DeliveryService.cs:958 stores it on the attempt.",
  },
  {
    file: "ProcuLink.Infrastructure/Services/Dispatchers/HttpDeliveryDispatcher.cs",
    carrier: "OrderDto.ErrorMessage",
    why: "BuildFailureMessage (:165) and the fixed catch literal (:177) become DeliveryResult.ErrorMessage → the attempt row.",
  },
  {
    file: "ProcuLink.Infrastructure/Services/Dispatchers/SmtpDeliveryDispatcher.cs",
    carrier: "OrderDto.ErrorMessage",
    why: "Three catch arms compose DeliveryResult.ErrorMessage (:169, :173, :177).",
  },
  {
    file: "ProcuLink.Infrastructure/Services/Dispatchers/SftpDeliveryDispatcher.cs",
    carrier: "OrderDto.ErrorMessage",
    why: "Socket-failure message (:268) becomes DeliveryResult.ErrorMessage.",
  },
  {
    file: "ProcuLink.Infrastructure/Services/Dispatchers/FtpsDeliveryDispatcher.cs",
    carrier: "OrderDto.ErrorMessage",
    why: "Socket-failure message (:208) becomes DeliveryResult.ErrorMessage.",
  },
  {
    file: "ProcuLink.Infrastructure/Services/Dispatchers/ErpDeliveryDispatchers.cs",
    carrier: "OrderDto.ErrorMessage",
    why: "Returns the ERP connector's message as DeliveryResult.ErrorMessage (:73).",
  },
  {
    file: "ProcuLink.Core/Services/RetentionConstants.cs",
    carrier: "OrderDto.ErrorMessage",
    why: "BlobPurgedError (:17) is used verbatim as the delivery failure at DeliveryService.cs:161 and :1332.",
  },

  // ── Acceptance-gate sentences (become the transform `error`) ────────────────
  {
    file: "ProcuLink.Api/Services/AcceptanceMessages.cs",
    carrier: "OrderDto.ErrorMessage",
    why: "ForFail (:23) produces the (why, fix) sentence pairs the gate refuses with; they reach FailTransformAsync.",
  },
  {
    file: "ProcuLink.Core/Services/IAcceptanceGate.cs",
    carrier: "OrderDto.ErrorMessage",
    why: "AcceptanceGateMessage.Compose (:181) stitches those into the paragraph stored as the transform error.",
  },

  // ── Order exception messages, rendered raw ──────────────────────────────────
  {
    file: "ProcuLink.Infrastructure/Services/OrderExceptionService.cs",
    carrier: "OrderExceptionDto.Message",
    why: "ProblemFor (:40-60) is a literal message table; assigned at :144 and rendered RAW at ExceptionDetail.tsx:160.",
  },

  // ── Order-action 4xx bodies, rendered by the same panel ─────────────────────
  {
    file: "ProcuLink.Api/Controllers/OrdersController.cs",
    carrier: "ApiHttpError.message",
    why: "Its 4xx `error` bodies become ApiHttpError.message, which OrderProblemPanel.tsx:233 renders at :344; it also derives OrderDto.ErrorMessage itself (:491-599).",
  },
];

/**
 * A Microsoft.Extensions.Logging / Serilog message template hole: `{OrderId}`, `{FileKey}`.
 *
 * THIS IS THE WHOLE DISCRIMINATOR BETWEEN A LOG LINE AND OPERATOR COPY, so it is worth
 * being exact about why it works. A log template is a PLAIN (non-`$`) C# string whose
 * braces survive into the literal text with their names attached. An interpolated string
 * — which is how every operator sentence carrying a value is written — is normalised by
 * the reader to `{}`, because the hole is an expression rather than a name.
 *
 * Measured: over the five production projects, the corpus-wide scan drops from 229
 * block-tier hits to 17 when this filter is applied, and every one of the 212 removed is a
 * `_logger.Log*` argument. That is the difference between a list a backend packet can act
 * on and a list nobody reads.
 *
 * ITS FAILURE MODE IS STATED RATHER THAN HIDDEN: an operator sentence that happened to
 * contain `{Word}` in Pascal case would be skipped. None does today, and the anti-vacuity
 * floor in the test would notice a filter that started dropping most of the corpus.
 */
const LOG_TEMPLATE_HOLE = /\{[A-Z][A-Za-z0-9]*\}/;

/**
 * True when a C# literal is a sentence an operator could be shown.
 *
 * Deliberately conservative in the direction that matters: it is better to scan a log line
 * by accident (a reviewer sees it in the list and drops it) than to skip a real sentence,
 * because a skipped sentence is exactly the silent hole this file exists to close. The one
 * exception is the log-template rule above, which is measured and precise.
 */
export function isOperatorSentence(text: string): boolean {
  const t = text.trim();
  if (LOG_TEMPLATE_HOLE.test(t)) return false;
  if (t.length < 12) return false;
  if (!/[a-z]/.test(t)) return false;
  // Sentence-cased, or opening on an interpolated value ("{} could not be applied").
  if (!/^[A-Z{]/.test(t)) return false;
  if (t.split(/\s+/).filter((w) => /[A-Za-z]/.test(w)).length < 3) return false;
  if (/^https?:\/\//i.test(t)) return false;
  if (/<\/?[a-z][^>]*>/i.test(t)) return false; // an XML/HTML template fragment
  if (/^\s*(SELECT|INSERT|UPDATE|DELETE)\s/i.test(t)) return false;
  return true;
}

/** One banned word in one backend sentence, located. */
export interface CopyViolation {
  readonly file: string;
  readonly line: number;
  readonly tier: string;
  readonly term: string;
  readonly text: string;
}

export interface ScanResult {
  readonly violations: CopyViolation[];
  /** Every literal read, sentence or not — the denominator for the vacuity floor. */
  readonly literalCount: number;
  /** Literals that passed `isOperatorSentence`. */
  readonly sentenceCount: number;
  /** Per corpus file, how many sentences it yielded. Zero means the file stopped parsing. */
  readonly sentencesByFile: Record<string, number>;
}

/**
 * Scan the corpus for banned words.
 *
 * Reports EVERY tier, including the warn-only gloss tier, and tags each hit with its tier
 * name — the severity decision belongs to the caller, exactly as it does in
 * check-vocabulary.mjs, so the two consumers cannot come to disagree about which words
 * fail a build.
 */
export function scanUserFacingCopy(
  backendRoot: string,
  sources: readonly UserFacingSource[] = USER_FACING_SOURCES,
): ScanResult {
  const violations: CopyViolation[] = [];
  const sentencesByFile: Record<string, number> = {};
  let literalCount = 0;
  let sentenceCount = 0;

  for (const source of sources) {
    const cs = readFileSync(join(backendRoot, source.file), "utf8");
    sentencesByFile[source.file] = 0;

    for (const { text, start } of parseCsStringExpressionsWithOffsets(cs)) {
      literalCount += 1;
      if (!isOperatorSentence(text)) continue;
      sentenceCount += 1;
      sentencesByFile[source.file] += 1;
      const line = lineOf(cs, start);

      for (const tier of TIERS) {
        // A fresh /g matcher per span: a shared one carries `lastIndex` between spans and
        // silently skips hits. Enumerating rather than testing so a sentence using two
        // banned words reports both.
        const re = termPattern(tier.terms, "g");
        const found = new Set<string>();
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) found.add(m[1].toLowerCase());
        for (const term of [...found].sort()) {
          violations.push({ file: source.file, line, tier: tier.name, term, text });
        }
      }
    }
  }

  violations.sort(
    (a, b) =>
      a.file.localeCompare(b.file) || a.line - b.line || a.tier.localeCompare(b.tier) || a.term.localeCompare(b.term),
  );
  return { violations, literalCount, sentenceCount, sentencesByFile };
}

/** The tiers whose hits fail a build (metaphor + jargon). Gloss is warn-only, both sides. */
export const BLOCKING_TIERS: readonly string[] = TIERS.filter((t) => t.blocks).map((t) => t.name);

/** `file:line:tier:term` — the stable identity of one violation, for the baseline diff. */
export function violationKey(v: Pick<CopyViolation, "file" | "line" | "tier" | "term">): string {
  return `${v.file}:${v.line}:${v.tier}:${v.term}`;
}
