# Wave 2 Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the highest-value Wave 2 gaps from the production audit: Hangfire job contention, mapping learning loop, durable PO Passport event ledger, in-memory order search, and revenue-critical controller test coverage.

**Architecture:** Five sequential backend tasks in `C:\Users\Dmitri.MARKIT\source\repos\ProcuLink`. Tasks 2–4 each produce one EF migration; they must run in order and push before the next starts to avoid migration conflicts. Task 5 adds tests only. Tasks touching different files can commit independently.

**Tech Stack:** ASP.NET Core 8 / C# / EF Core 8 / PostgreSQL / Hangfire / xUnit + Moq. Package manager: `dotnet`.

---

## File Map

| Task | Files modified/created |
|---|---|
| W2-T1 Queues | `ProcuLink.Worker/Program.cs`, 11 job `*.cs` files |
| W2-T2 Corrections | `ProcuLink.Core/Entities/ItemMapping.cs`, new `MappingCorrection.cs`, `ProcuLink.Infrastructure/ProcuLinkDbContext.cs`, `ProcuLink.Infrastructure/Services/ItemMappingService.cs`, migration |
| W2-T3 Passport events | new `PoPassportEvent.cs` entity, `ProcuLinkDbContext.cs`, `ProcuLink.Api/Services/OrderService.cs`, migration |
| W2-T4 buyer_name | `ProcuLink.Core/Entities/PurchaseOrderEntity.cs`, `ProcuLinkDbContext.cs`, `OrderService.cs` (ListPagedAsync + ParseStoredFileAsync), migration |
| W2-T5 Tests | new `BillingControllerTests.cs`, `WebhookIngressControllerTests.cs`, `ApiKeyControllerTests.cs` |

---

## Task 1 — Hangfire queue segregation

**Repo:** `C:\Users\Dmitri.MARKIT\source\repos\ProcuLink`

**Context:** All 11 job types share the single `"default"` queue with 4 workers. A polling burst (email+SFTP+S3 across 30 orgs) enqueues ~90 jobs simultaneously, starving parse and delivery workers. Fix: add `[Queue("...")]` attributes to each job's execute method and declare named queues in the Worker with differentiated worker counts.

**Queue assignment:**
- `"critical"` — `ParseOrderJob`, `TransformOrderJob`, `DeliverOrderJob`, `ParseInvoiceJob`
- `"delivery-retry"` — `RetryDeliveryJob`
- `"polling"` — `EmailPollingJob`, `EmailPollOrgJob`, `SftpPollingJob`, `SftpPollOrgJob`, `S3PollingJob`, `S3PollOrgJob`
- `"background"` — `StuckOrderDetectionJob`, `DeliverySlaSweepJob`, `FireIntegrationTriggerJob`

**Files:**
- Modify: `ProcuLink.Api/Jobs/ParseOrderJob.cs`, `TransformOrderJob.cs`, `DeliverOrderJob.cs`, `ParseInvoiceJob.cs`
- Modify: `ProcuLink.Infrastructure/Jobs/RetryDeliveryJob.cs`, `FireIntegrationTriggerJob.cs`
- Modify: `ProcuLink.Worker/Jobs/EmailPollingJob.cs`, `EmailPollOrgJob.cs`, `SftpPollingJob.cs`, `SftpPollOrgJob.cs`, `S3PollingJob.cs`, `S3PollOrgJob.cs`, `StuckOrderDetectionJob.cs`, `DeliverySlaSweepJob.cs`
- Modify: `ProcuLink.Worker/Program.cs`

- [ ] **Step 1.1 — Pull latest**
```bash
cd "C:\Users\Dmitri.MARKIT\source\repos\ProcuLink"
git pull origin main
```

- [ ] **Step 1.2 — Read each job file to find its execute method name**

List the execute method for each job before editing. The pattern: each job class has one method decorated with `[AutomaticRetry(Attempts = N)]` — add `[Queue("...")]` on the line immediately above `[AutomaticRetry]` on the same method.

Read each of the 11 job files briefly to confirm the method name. Typical pattern:
```csharp
[Queue("critical")]
[AutomaticRetry(Attempts = 3)]
public async Task ExecuteAsync(Guid orderId, Guid orgId, CancellationToken ct)
```

- [ ] **Step 1.3 — Add `[Queue]` attributes to critical queue jobs**

In `ProcuLink.Api/Jobs/ParseOrderJob.cs`, `TransformOrderJob.cs`, `DeliverOrderJob.cs`, `ParseInvoiceJob.cs`: add `[Queue("critical")]` above the existing `[AutomaticRetry]` attribute on the execute method.

Example for `ParseOrderJob.cs` (find the execute method — it is `ExecuteAsync`):
```csharp
[Queue("critical")]
[AutomaticRetry(Attempts = 3, DelaysInSeconds = new[] { 30, 120, 600 })]
public async Task ExecuteAsync(Guid orderId, Guid organisationId, CancellationToken ct)
```

- [ ] **Step 1.4 — Add `[Queue("delivery-retry")]` to `RetryDeliveryJob.cs`**

In `ProcuLink.Infrastructure/Jobs/RetryDeliveryJob.cs`, add `[Queue("delivery-retry")]` above its `[AutomaticRetry]`.

- [ ] **Step 1.5 — Add `[Queue("polling")]` to all 6 polling jobs**

In `ProcuLink.Worker/Jobs/`: `EmailPollingJob.cs`, `EmailPollOrgJob.cs`, `SftpPollingJob.cs`, `SftpPollOrgJob.cs`, `S3PollingJob.cs`, `S3PollOrgJob.cs` — add `[Queue("polling")]` above each job's `[AutomaticRetry]`.

- [ ] **Step 1.6 — Add `[Queue("background")]` to sweep/detection/integration jobs**

In `ProcuLink.Worker/Jobs/StuckOrderDetectionJob.cs`, `DeliverySlaSweepJob.cs`, and `ProcuLink.Infrastructure/Jobs/FireIntegrationTriggerJob.cs` — add `[Queue("background")]`.

- [ ] **Step 1.7 — Update `Worker/Program.cs` queue config**

Find lines 53-58:
```csharp
builder.Services.AddHangfireServer(opts =>
{
    // Worker is the sole Hangfire executor — also processes ParseOrderJob enqueued by the API.
    opts.WorkerCount = 4;
    opts.Queues = new[] { "default" };
});
```

Replace with:
```csharp
builder.Services.AddHangfireServer(opts =>
{
    // Named queues by workload type — prevents polling bursts from starving parse/delivery.
    // Priority order: Hangfire processes queues left-to-right, pulling from the next only when
    // the higher-priority queue is empty.
    opts.WorkerCount = 10;
    opts.Queues = new[] { "critical", "delivery-retry", "polling", "background", "default" };
});
```

- [ ] **Step 1.8 — Build**
```bash
dotnet build ProcuLink.slnx --no-restore 2>&1 | tail -5
```
Expected: `Build succeeded. 0 Error(s)`

- [ ] **Step 1.9 — Full test suite**
```bash
dotnet test --configuration Release 2>&1 | tail -8
```
Expected: all pass.

- [ ] **Step 1.10 — Commit and push**
```bash
git add ProcuLink.Api/Jobs/ ProcuLink.Infrastructure/Jobs/ ProcuLink.Worker/Jobs/ ProcuLink.Worker/Program.cs
git commit -m "perf: segregate Hangfire queues by workload type (critical/delivery-retry/polling/background)"
git push origin main
```

---

## Task 2 — Mapping corrections table + AppliedCount

**Repo:** `C:\Users\Dmitri.MARKIT\source\repos\ProcuLink`

**Context:** `ItemMapping` has no usage counter and no correction history. When a design partner fixes a wrong AI suggestion, there is no record of what was fixed or how many times the mapping has been applied. Fix: add `AppliedCount` to `item_mappings` and create a `mapping_corrections` table that records every code change with provenance.

**Files:**
- Modify: `ProcuLink.Core/Entities/ItemMapping.cs`
- Create: `ProcuLink.Core/Entities/MappingCorrection.cs`
- Modify: `ProcuLink.Infrastructure/ProcuLinkDbContext.cs`
- Modify: `ProcuLink.Infrastructure/Services/ItemMappingService.cs`
- Create: migration (`dotnet ef migrations add Wave2MappingCorrections`)

- [ ] **Step 2.1 — Pull latest**
```bash
cd "C:\Users\Dmitri.MARKIT\source\repos\ProcuLink"
git pull origin main
```

- [ ] **Step 2.2 — Add `AppliedCount` to `ItemMapping.cs`**

In `ProcuLink.Core/Entities/ItemMapping.cs`, add one property after `Source`:
```csharp
    /// <summary>How many times this mapping has been applied during order resolution.</summary>
    public int AppliedCount { get; set; }
```

- [ ] **Step 2.3 — Create `MappingCorrection.cs`**

Create `ProcuLink.Core/Entities/MappingCorrection.cs`:
```csharp
namespace ProcuLink.Core.Entities;

/// <summary>
/// Immutable record of a change to a supplier item code on a mapping row.
/// Written whenever UpsertAsync overwrites an existing SupplierItemCode so
/// the learning loop knows what was wrong and what replaced it.
/// </summary>
public class MappingCorrection
{
    public Guid     Id                   { get; set; }
    public Guid     OrgId                { get; set; }
    public Guid     MappingId            { get; set; }
    public string   OldSupplierItemCode  { get; set; } = string.Empty;
    public string   NewSupplierItemCode  { get; set; } = string.Empty;
    /// <summary>manual | ai_accepted | imported</summary>
    public string   Source               { get; set; } = "manual";
    public DateTime CorrectedAt          { get; set; }

    // Navigation
    public Organisation Organisation     { get; set; } = null!;
    public ItemMapping  Mapping           { get; set; } = null!;
}
```

- [ ] **Step 2.4 — Register in `ProcuLinkDbContext.cs`**

Add `DbSet<MappingCorrection> MappingCorrections` near the `ItemMappings` DbSet (around line 40). Then add the EF config block in `OnModelCreating`. Find the `// ── item_mappings` comment and add after it:

```csharp
        // ── mapping_corrections ────────────────────────────────────────
        modelBuilder.Entity<MappingCorrection>(b =>
        {
            b.ToTable("mapping_corrections");
            b.HasKey(x => x.Id);
            b.Property(x => x.Id).HasColumnName("id");
            b.Property(x => x.OrgId).HasColumnName("org_id");
            b.Property(x => x.MappingId).HasColumnName("mapping_id");
            b.Property(x => x.OldSupplierItemCode).HasColumnName("old_supplier_item_code").IsRequired();
            b.Property(x => x.NewSupplierItemCode).HasColumnName("new_supplier_item_code").IsRequired();
            b.Property(x => x.Source).HasColumnName("source").IsRequired();
            b.Property(x => x.CorrectedAt).HasColumnName("corrected_at").HasColumnType("timestamptz");
            b.HasOne(x => x.Organisation).WithMany().HasForeignKey(x => x.OrgId);
            b.HasOne(x => x.Mapping).WithMany().HasForeignKey(x => x.MappingId);
            b.HasIndex(x => new { x.OrgId, x.MappingId, x.CorrectedAt })
             .HasDatabaseName("IX_mapping_corrections_org_id_mapping_id_corrected_at");
        });
```

Also add `AppliedCount` to the existing `item_mappings` EF config block. Find `b.Property(x => x.Source)` in the item_mappings block and add after it:
```csharp
            b.Property(x => x.AppliedCount).HasColumnName("applied_count").HasDefaultValue(0);
```

And add a navigation property for corrections on `ItemMapping`:
```csharp
            b.HasMany<MappingCorrection>().WithOne(x => x.Mapping).HasForeignKey(x => x.MappingId);
```

- [ ] **Step 2.5 — Update `ItemMappingService.UpsertAsync` to write correction and increment count**

Read `ProcuLink.Infrastructure/Services/ItemMappingService.cs` fully. In `UpsertAsync`, the `else` branch handles an existing mapping. Update it to:

```csharp
        else
        {
            var codeChanged = !string.Equals(
                existing.SupplierItemCode, supplierItemCode.Trim(),
                StringComparison.OrdinalIgnoreCase);

            if (codeChanged)
            {
                // Record the correction before overwriting the code
                _db.MappingCorrections.Add(new MappingCorrection
                {
                    Id                  = Guid.NewGuid(),
                    OrgId               = orgId,
                    MappingId           = existing.Id,
                    OldSupplierItemCode = existing.SupplierItemCode,
                    NewSupplierItemCode = supplierItemCode.Trim(),
                    Source              = sourceStr,
                    CorrectedAt         = now,
                });
            }

            existing.SupplierItemCode = supplierItemCode.Trim();
            existing.Source           = sourceStr;
            existing.Confidence       = source == MappingSource.Manual ? 1.0f : existing.Confidence;
            existing.AppliedCount     += 1;
            existing.UpdatedAt        = now;
        }
```

- [ ] **Step 2.6 — Write tests**

Create `ProcuLink.Infrastructure.Tests/Services/ItemMappingServiceCorrectionTests.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using ProcuLink.Core.Entities;
using ProcuLink.Core.Services.Mapping;
using ProcuLink.Infrastructure;
using ProcuLink.Infrastructure.Services;
using Xunit;

namespace ProcuLink.Infrastructure.Tests.Services;

public class ItemMappingServiceCorrectionTests
{
    private static ProcuLinkDbContext MakeDb() =>
        new(new DbContextOptionsBuilder<ProcuLinkDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options);

    private static ItemMappingService MakeSvc(ProcuLinkDbContext db) => new(db);

    [Fact]
    public async Task UpsertAsync_NewMapping_DoesNotCreateCorrection()
    {
        var db  = MakeDb();
        var svc = MakeSvc(db);
        var orgId      = Guid.NewGuid();
        var supplierId = Guid.NewGuid();

        await svc.UpsertAsync(orgId, supplierId, "BUYER-001", "SUP-001",
            MappingSource.Manual, CancellationToken.None);

        Assert.Empty(db.MappingCorrections);
        var mapping = await db.ItemMappings.SingleAsync();
        Assert.Equal(1, mapping.AppliedCount);
    }

    [Fact]
    public async Task UpsertAsync_ExistingMappingSameCode_IncrementCountNoCorrection()
    {
        var db  = MakeDb();
        var svc = MakeSvc(db);
        var orgId      = Guid.NewGuid();
        var supplierId = Guid.NewGuid();

        await svc.UpsertAsync(orgId, supplierId, "BUYER-001", "SUP-001",
            MappingSource.Manual, CancellationToken.None);
        await svc.UpsertAsync(orgId, supplierId, "BUYER-001", "SUP-001",
            MappingSource.Manual, CancellationToken.None);

        Assert.Empty(db.MappingCorrections);
        var mapping = await db.ItemMappings.SingleAsync();
        Assert.Equal(2, mapping.AppliedCount);
    }

    [Fact]
    public async Task UpsertAsync_ExistingMappingCodeChanged_WritesCorrection()
    {
        var db  = MakeDb();
        var svc = MakeSvc(db);
        var orgId      = Guid.NewGuid();
        var supplierId = Guid.NewGuid();

        await svc.UpsertAsync(orgId, supplierId, "BUYER-001", "SUP-OLD",
            MappingSource.Manual, CancellationToken.None);
        await svc.UpsertAsync(orgId, supplierId, "BUYER-001", "SUP-NEW",
            MappingSource.Manual, CancellationToken.None);

        var correction = await db.MappingCorrections.SingleAsync();
        Assert.Equal("SUP-OLD", correction.OldSupplierItemCode);
        Assert.Equal("SUP-NEW", correction.NewSupplierItemCode);
    }
}
```

- [ ] **Step 2.7 — Run tests to confirm they fail first, then pass**
```bash
cd "C:\Users\Dmitri.MARKIT\source\repos\ProcuLink"
dotnet test ProcuLink.Infrastructure.Tests/ProcuLink.Infrastructure.Tests.csproj \
  --filter "FullyQualifiedName~ItemMappingServiceCorrectionTests" -v minimal 2>&1 | tail -10
```

- [ ] **Step 2.8 — Build and generate migration**
```bash
dotnet build ProcuLink.slnx --no-restore 2>&1 | tail -5
dotnet ef migrations add Wave2MappingCorrections \
  --project ProcuLink.Infrastructure \
  --startup-project ProcuLink.Api 2>&1 | tail -5
```
Inspect the migration: `Up()` must have `CreateTable("mapping_corrections", ...)` and `AddColumn("applied_count", ...)`.

- [ ] **Step 2.9 — Full test suite**
```bash
dotnet test --configuration Release 2>&1 | tail -8
```

- [ ] **Step 2.10 — Commit and push**
```bash
git add ProcuLink.Core/Entities/ \
        ProcuLink.Infrastructure/ProcuLinkDbContext.cs \
        ProcuLink.Infrastructure/Services/ItemMappingService.cs \
        ProcuLink.Infrastructure/Migrations/ \
        ProcuLink.Infrastructure.Tests/Services/ItemMappingServiceCorrectionTests.cs
git commit -m "feat(learning): mapping_corrections ledger + AppliedCount usage counter on item_mappings"
git push origin main
```

---

## Task 3 — po_passport_events append-only ledger

**Repo:** `C:\Users\Dmitri.MARKIT\source\repos\ProcuLink`

**Context:** The PO Passport (`PassportService.cs`) currently assembles its timeline by reconstructing events from general-purpose `audit_events` rows — it has no `stage` field, no guaranteed immutability, and `validationResults` is explicitly empty (`Array.Empty<>()`). Fix: add a dedicated append-only `po_passport_events` table and emit events at the four most important lifecycle stages. The Passport service will read from this table first.

**Files:**
- Create: `ProcuLink.Core/Entities/PoPassportEvent.cs`
- Modify: `ProcuLink.Infrastructure/ProcuLinkDbContext.cs`
- Modify: `ProcuLink.Api/Services/OrderService.cs` (emit events at upload, parse, resolve, AI-accept)
- Modify: `ProcuLink.Api/Services/PassportService.cs` (read new table)
- Create: migration (`dotnet ef migrations add Wave2PassportEvents`)

- [ ] **Step 3.1 — Pull latest**
```bash
cd "C:\Users\Dmitri.MARKIT\source\repos\ProcuLink"
git pull origin main
```

- [ ] **Step 3.2 — Create `PoPassportEvent.cs`**

Create `ProcuLink.Core/Entities/PoPassportEvent.cs`:
```csharp
namespace ProcuLink.Core.Entities;

/// <summary>
/// Append-only record of a lifecycle event for a purchase order.
/// Written at upload, parse, resolve/correct, AI-accept, transform, and delivery.
/// Never updated or deleted — immutable evidence for the PO Passport.
/// </summary>
public class PoPassportEvent
{
    public Guid     Id         { get; set; }
    public Guid     OrgId      { get; set; }
    public Guid     OrderId    { get; set; }
    /// <summary>Parse | Validate | Map | Transform | Deliver | Upload</summary>
    public string   Stage      { get; set; } = string.Empty;
    /// <summary>Created | Succeeded | Failed | Corrected | AiAccepted | AiRejected</summary>
    public string   EventType  { get; set; } = string.Empty;
    /// <summary>user | system | ai</summary>
    public string   ActorType  { get; set; } = "system";
    public string?  ActorId    { get; set; }
    public System.Text.Json.JsonDocument? Payload { get; set; }
    public DateTime OccurredAt { get; set; }

    // Navigation
    public Organisation Organisation { get; set; } = null!;
}
```

- [ ] **Step 3.3 — Register in `ProcuLinkDbContext.cs`**

Add `DbSet<PoPassportEvent> PoPassportEvents` to the DbSet list. Add EF config block:

```csharp
        // ── po_passport_events ──────────────────────────────────────────
        modelBuilder.Entity<PoPassportEvent>(b =>
        {
            b.ToTable("po_passport_events");
            b.HasKey(x => x.Id);
            b.Property(x => x.Id).HasColumnName("id");
            b.Property(x => x.OrgId).HasColumnName("org_id");
            b.Property(x => x.OrderId).HasColumnName("order_id");
            b.Property(x => x.Stage).HasColumnName("stage").IsRequired();
            b.Property(x => x.EventType).HasColumnName("event_type").IsRequired();
            b.Property(x => x.ActorType).HasColumnName("actor_type").IsRequired();
            b.Property(x => x.ActorId).HasColumnName("actor_id");
            b.Property(x => x.Payload)
             .HasColumnName("payload")
             .HasColumnType("jsonb")
             .HasConversion(jsonDocConverter);
            b.Property(x => x.OccurredAt)
             .HasColumnName("occurred_at")
             .HasColumnType("timestamptz");
            b.HasOne(x => x.Organisation).WithMany().HasForeignKey(x => x.OrgId);
            b.HasIndex(x => new { x.OrgId, x.OrderId, x.OccurredAt })
             .HasDatabaseName("IX_po_passport_events_org_id_order_id_occurred_at");
        });
```

Note: `jsonDocConverter` is already defined earlier in `OnModelCreating` — reuse it (search for `jsonDocConverter` in the file to find its exact name/type).

- [ ] **Step 3.4 — Add a helper method to `OrderService.cs` for emitting events**

Read `OrderService.cs` to understand its structure. Add a private helper near the bottom:

```csharp
    private async Task EmitPassportEventAsync(
        Guid orgId, Guid orderId,
        string stage, string eventType,
        string actorType = "system", string? actorId = null,
        object? payload = null,
        CancellationToken ct = default)
    {
        _db.PoPassportEvents.Add(new PoPassportEvent
        {
            Id        = Guid.NewGuid(),
            OrgId     = orgId,
            OrderId   = orderId,
            Stage     = stage,
            EventType = eventType,
            ActorType = actorType,
            ActorId   = actorId,
            Payload   = payload is null ? null
                        : System.Text.Json.JsonDocument.Parse(
                            System.Text.Json.JsonSerializer.Serialize(payload)),
            OccurredAt = DateTime.UtcNow,
        });
        await _db.SaveChangesAsync(ct);
    }
```

- [ ] **Step 3.5 — Emit events at key lifecycle points in `OrderService.cs`**

Read the relevant methods in `OrderService.cs` to find the right insertion points. Add `EmitPassportEventAsync` calls after `SaveChangesAsync` at:

**In `CreateStubAsync` or `CreateStubFromParsedOrderAsync`** (after order is created):
```csharp
await EmitPassportEventAsync(orgId, stub.Id, "Upload", "Created",
    payload: new { source = stub.SourceFileKey }, ct: ct);
```

**In `ParseStoredFileAsync`** (after successful parse sets status to pending_review/ready):
```csharp
await EmitPassportEventAsync(orgId, entity.Id, "Parse", "Succeeded",
    payload: new { lineCount = entity.Lines.Count }, ct: ct);
```

**In `ResolveAsync`** (after lines are resolved):
```csharp
await EmitPassportEventAsync(orgId, entity.Id, "Map", "Corrected",
    actorType: "user",
    payload: new { linesResolved = resolutions.Count, savedMappings = saveMappings }, ct: ct);
```

**In `AcceptAiSuggestionsAsync`** (after AI suggestions accepted):
```csharp
await EmitPassportEventAsync(orgId, entity.Id, "Map", "AiAccepted",
    actorType: "ai",
    payload: new { accepted = acceptedCount }, ct: ct);
```

Do not add SaveChangesAsync calls — use the helper which calls SaveChangesAsync internally.

- [ ] **Step 3.6 — Update `PassportService.cs` to include events in timeline**

Read `ProcuLink.Api/Services/PassportService.cs`. Find where `timeline` is built (it currently reads from `AuditEvent`s). Add an additional query for `PoPassportEvent` rows and merge them into the timeline:

```csharp
// Append durable passport events to the timeline
var passportEvents = await _db.PoPassportEvents
    .AsNoTracking()
    .Where(e => e.OrgId == orgId && e.OrderId == orderId)
    .OrderBy(e => e.OccurredAt)
    .Select(e => new PassportEvent
    {
        Action = $"{e.Stage}.{e.EventType}",
        At     = e.OccurredAt.ToString("o"),
        Payload = null,
    })
    .ToListAsync(ct);

// Merge with existing audit-derived events
timeline.AddRange(passportEvents);
timeline.Sort((a, b) => string.CompareOrdinal(a.At, b.At));
```

Adapt to the exact `PassportEvent` constructor/shape used in that file.

- [ ] **Step 3.7 — Build and generate migration**
```bash
dotnet build ProcuLink.slnx --no-restore 2>&1 | tail -5
dotnet ef migrations add Wave2PassportEvents \
  --project ProcuLink.Infrastructure \
  --startup-project ProcuLink.Api 2>&1 | tail -5
```

- [ ] **Step 3.8 — Full test suite**
```bash
dotnet test --configuration Release 2>&1 | tail -8
```
Expected: all pass.

- [ ] **Step 3.9 — Commit and push**
```bash
git add ProcuLink.Core/Entities/PoPassportEvent.cs \
        ProcuLink.Infrastructure/ProcuLinkDbContext.cs \
        ProcuLink.Api/Services/OrderService.cs \
        ProcuLink.Api/Services/PassportService.cs \
        ProcuLink.Infrastructure/Migrations/
git commit -m "feat(passport): append-only po_passport_events ledger with lifecycle event emission"
git push origin main
```

---

## Task 4 — buyer_name column + SQL-native order search

**Repo:** `C:\Users\Dmitri.MARKIT\source\repos\ProcuLink`

**Context:** `OrderService.ListPagedAsync` loads ALL org orders into memory because `buyer_name` is buried in `canonical_json` (jsonb), forcing an in-memory search filter. Fix: promote `buyer_name` to a first-class `varchar` column on `purchase_orders`, populate it during parse, add a btree index, and rewrite the search to use SQL predicates.

**Files:**
- Modify: `ProcuLink.Core/Entities/PurchaseOrderEntity.cs`
- Modify: `ProcuLink.Infrastructure/ProcuLinkDbContext.cs`
- Modify: `ProcuLink.Api/Services/OrderService.cs` (ListPagedAsync + ParseStoredFileAsync)
- Create: migration (`dotnet ef migrations add Wave2BuyerNameColumn`)

- [ ] **Step 4.1 — Pull latest**
```bash
cd "C:\Users\Dmitri.MARKIT\source\repos\ProcuLink"
git pull origin main
```

- [ ] **Step 4.2 — Add `BuyerName` to `PurchaseOrderEntity.cs`**

Read `ProcuLink.Core/Entities/PurchaseOrderEntity.cs`. Add one property after `PoNumber` or near other string properties:

```csharp
    /// <summary>
    /// Buyer name extracted from CanonicalJson at parse time.
    /// Null while the order is still parsing or if no buyer name was found.
    /// Duplicates the value in CanonicalJson for SQL-filterable search.
    /// </summary>
    public string? BuyerName { get; set; }
```

- [ ] **Step 4.3 — Add EF config + index to `ProcuLinkDbContext.cs`**

Find the `purchase_orders` entity config block. After the `PoNumber` property mapping, add:
```csharp
            b.Property(x => x.BuyerName).HasColumnName("buyer_name");
```

After the last `HasForeignKey` in the block (before `});`), add:
```csharp
            b.HasIndex(x => new { x.OrgId, x.BuyerName })
             .HasDatabaseName("IX_purchase_orders_org_id_buyer_name");
```

- [ ] **Step 4.4 — Read `OrderService.ListPagedAsync` fully**

Read `ProcuLink.Api/Services/OrderService.cs` from approximately line 664 (the `ListPagedAsync` method). Understand the current 7-step flow (SQL filter → ToListAsync → in-memory search → count → paginate → line counts → project).

- [ ] **Step 4.5 — Rewrite `ListPagedAsync` to use SQL-native search**

Replace Steps 2–4 of `ListPagedAsync` (the in-memory loading + search + count) with a fully-SQL approach:

The new flow for `ListPagedAsync`:

**Step 2 (new):** Add search predicate to the SQL query before materializing:
```csharp
        if (!string.IsNullOrWhiteSpace(search))
        {
            var trimmedSearch = search.Trim();
            baseQuery = baseQuery.Where(o =>
                EF.Functions.ILike(o.PoNumber, $"%{trimmedSearch}%") ||
                EF.Functions.ILike(o.Supplier!.Name, $"%{trimmedSearch}%") ||
                (o.BuyerName != null && EF.Functions.ILike(o.BuyerName, $"%{trimmedSearch}%")));
        }
```

**Step 3 (new):** Get total count from SQL (not from in-memory filtered list):
```csharp
        var totalCount = await baseQuery.CountAsync(ct);
        if (totalCount == 0)
            return Result<(IReadOnlyList<PurchaseOrderSummary>, int)>.Ok(
                (Array.Empty<PurchaseOrderSummary>(), 0));
```

**Step 4 (new):** Apply ORDER BY and page in SQL, then project minimal columns:
```csharp
        var paged = await baseQuery
            .OrderByDescending(o => o.CreatedAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(o => new
            {
                o.Id,
                o.PoNumber,
                SupplierName = o.Supplier != null ? o.Supplier.Name : "Unknown Supplier",
                o.BuyerName,
                o.OrderDate,
                o.Status,
                o.CreatedAt,
                o.Currency,
                o.SourceFileKey,
            })
            .ToListAsync(ct);
```

Then Steps 5–7 remain as before (line counts + project to PurchaseOrderSummary), but replace the `buyerName` extraction from `CanonicalJson` with `o.BuyerName` directly.

Remove the old `var allRows = await baseQuery...ToListAsync(ct)` load and the in-memory `filtered` loop entirely.

- [ ] **Step 4.6 — Populate `BuyerName` during parse**

Read `OrderService.ParseStoredFileAsync` (or wherever `CanonicalJson` is first set on the order). Find where `entity.CanonicalJson` is assigned after parsing. Add buyer name extraction immediately after:

```csharp
// Populate denormalised BuyerName for SQL-filterable search
if (entity.CanonicalJson is not null)
{
    try
    {
        var root = entity.CanonicalJson.RootElement;
        if (root.TryGetProperty("buyerName", out var bn) || root.TryGetProperty("BuyerName", out bn))
            entity.BuyerName = bn.GetString();
    }
    catch { /* malformed canonical_json — leave BuyerName null */ }
}
```

- [ ] **Step 4.7 — Build and generate migration**
```bash
dotnet build ProcuLink.slnx --no-restore 2>&1 | tail -5
dotnet ef migrations add Wave2BuyerNameColumn \
  --project ProcuLink.Infrastructure \
  --startup-project ProcuLink.Api 2>&1 | tail -5
```

Inspect migration: `Up()` must have `AddColumn("buyer_name", ...)` and `CreateIndex("IX_purchase_orders_org_id_buyer_name", ...)`.

- [ ] **Step 4.8 — Update existing tests that use `ListPagedAsync` or mock order data**

Run the full suite to find any failures from the schema change:
```bash
dotnet test --configuration Release 2>&1 | grep -E "FAIL|Error" | head -20
```

If `OrderServiceListPagedTests` or similar tests fail, update them to either:
- Set `BuyerName` on test order entities directly (instead of reading from `CanonicalJson`), or
- Keep `CanonicalJson` for the in-memory EF provider (in-memory EF does not use `ILike` so tests may need adjustment)

Note: `EF.Functions.ILike` throws on the in-memory provider. If existing tests use in-memory EF and call `ListPagedAsync` with a `search` parameter, either mock the DbContext or use a real test database via the existing Testcontainers/Postgres setup in `EndToEndPipelineTests`.

If in-memory search tests break, update them to test that `BuyerName` is set on the entity and `PoNumber`/`SupplierName` search still works (these do use `ILike` which may need special handling).

- [ ] **Step 4.9 — Full test suite**
```bash
dotnet test --configuration Release 2>&1 | tail -8
```

- [ ] **Step 4.10 — Commit and push**
```bash
git add ProcuLink.Core/Entities/PurchaseOrderEntity.cs \
        ProcuLink.Infrastructure/ProcuLinkDbContext.cs \
        ProcuLink.Api/Services/OrderService.cs \
        ProcuLink.Infrastructure/Migrations/
git commit -m "perf: buyer_name column on purchase_orders + SQL-native order search (eliminates in-memory full-table load)"
git push origin main
```

---

## Task 5 — Controller tests for BillingController, WebhookIngressController, ApiKeyController

**Repo:** `C:\Users\Dmitri.MARKIT\source\repos\ProcuLink`

**Context:** 24 of 28 backend controllers have zero test coverage. The three most critical surfaces are:
- `BillingController.Webhook` (`POST /api/billing/webhook`) — Stripe event ingestion; revenue-critical
- `WebhookIngressController` — HMAC-verified supplier callbacks; security surface
- `ApiKeyController` — API key lifecycle for machine-to-machine access

These three controllers have direct business value if they fail or allow unauthorized access.

The existing test pattern: `DbContextOptionsBuilder<ProcuLinkDbContext>().UseInMemoryDatabase(...)`, `Mock<ICurrentTenantService>()`, direct controller instantiation. See `DeliveriesControllerTests.cs` for the reference pattern.

**Files:**
- Create: `ProcuLink.Api.Tests/Controllers/BillingControllerTests.cs`
- Create: `ProcuLink.Api.Tests/Controllers/WebhookIngressControllerTests.cs`
- Create: `ProcuLink.Api.Tests/Controllers/ApiKeyControllerTests.cs`

- [ ] **Step 5.1 — Pull latest**
```bash
cd "C:\Users\Dmitri.MARKIT\source\repos\ProcuLink"
git pull origin main
```

- [ ] **Step 5.2 — Read the three controllers and their dependencies**

Read:
- `ProcuLink.Api/Controllers/BillingController.cs` — especially `Webhook()` and constructor args
- `ProcuLink.Api/Controllers/WebhookIngressController.cs` — especially `Ping`, `Acknowledge`, `Status` endpoints
- `ProcuLink.Api/Controllers/ApiKeyController.cs` — `List`, `Create`, `Delete` endpoints
- `ProcuLink.Core/Services/IApiKeyService.cs` — interface to mock
- `ProcuLink.Core/Services/Webhooks/IHmacWebhookVerifier.cs` — interface to mock

- [ ] **Step 5.3 — Create `ApiKeyControllerTests.cs`** (simplest — pure service mock)

Create `ProcuLink.Api.Tests/Controllers/ApiKeyControllerTests.cs`:

```csharp
using FluentAssertions;
using Microsoft.AspNetCore.Mvc;
using Moq;
using ProcuLink.Api.Controllers;
using ProcuLink.Core.Entities;
using ProcuLink.Core.Services;
using Xunit;

namespace ProcuLink.Api.Tests.Controllers;

public class ApiKeyControllerTests
{
    private static (ApiKeyController Ctrl, Guid OrgId) Build(
        Mock<IApiKeyService>? keysMock = null)
    {
        var orgId  = Guid.NewGuid();
        var tenant = new Mock<ICurrentTenantService>();
        tenant.SetupGet(t => t.OrganisationId).Returns(orgId);
        keysMock ??= new Mock<IApiKeyService>();
        return (new ApiKeyController(keysMock.Object, tenant.Object), orgId);
    }

    [Fact]
    public async Task List_ReturnsOkWithEmptyList_WhenNoKeys()
    {
        var keysMock = new Mock<IApiKeyService>();
        keysMock
            .Setup(s => s.ListAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Array.Empty<TenantApiKey>());

        var (ctrl, _) = Build(keysMock);
        var result = await ctrl.List(CancellationToken.None);

        result.Should().BeOfType<OkObjectResult>();
    }

    [Fact]
    public async Task Delete_CallsRevokeWithCorrectArgs()
    {
        var keyId    = Guid.NewGuid();
        var keysMock = new Mock<IApiKeyService>();
        keysMock
            .Setup(s => s.RevokeAsync(It.IsAny<Guid>(), keyId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);

        var (ctrl, _) = Build(keysMock);
        var result = await ctrl.Delete(keyId, CancellationToken.None);

        result.Should().BeOfType<NoContentResult>().Or.BeOfType<OkResult>()
            .Or.BeOfType<OkObjectResult>(); // accept any 2xx success shape
        keysMock.Verify(s => s.RevokeAsync(It.IsAny<Guid>(), keyId, It.IsAny<CancellationToken>()), Times.Once);
    }
}
```

Note: read the actual `IApiKeyService` interface and `ApiKeyController` methods before writing tests — adapt method names, return types, and overloads to what actually exists in the codebase. The test structure above shows the pattern; fill in real signatures.

- [ ] **Step 5.4 — Create `WebhookIngressControllerTests.cs`**

Create `ProcuLink.Api.Tests/Controllers/WebhookIngressControllerTests.cs`:

```csharp
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using ProcuLink.Api.Controllers;
using ProcuLink.Core.Services.Webhooks;
using ProcuLink.Infrastructure;
using Xunit;

namespace ProcuLink.Api.Tests.Controllers;

public class WebhookIngressControllerTests
{
    private static ProcuLinkDbContext MakeDb() =>
        new(new DbContextOptionsBuilder<ProcuLinkDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options);

    private static (WebhookIngressController Ctrl, Mock<IHmacWebhookVerifier> VerifierMock)
        Build(ProcuLinkDbContext? db = null)
    {
        db ??= MakeDb();
        var verifierMock = new Mock<IHmacWebhookVerifier>();
        var ctrl = new WebhookIngressController(
            db,
            verifierMock.Object,
            NullLogger<WebhookIngressController>.Instance);

        // Provide a stub HttpContext so Request.Body is readable
        ctrl.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext(),
        };

        return (ctrl, verifierMock);
    }

    [Fact]
    public async Task Ping_InvalidHmac_Returns401()
    {
        var (ctrl, verifierMock) = Build();

        verifierMock
            .Setup(v => v.VerifyAsync(
                It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>(),
                It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new HmacVerificationResult(false, "Signature verification failed", null));

        // Set required headers
        ctrl.Request.Headers["X-ProcuLink-Timestamp"] = DateTimeOffset.UtcNow.ToString("o");
        ctrl.Request.Headers["X-ProcuLink-Nonce"]     = Guid.NewGuid().ToString();
        ctrl.Request.Headers["X-ProcuLink-Signature"] = "badhex";
        ctrl.Request.Body = new MemoryStream(System.Text.Encoding.UTF8.GetBytes("{}"));

        var result = await ctrl.Ping("test-slug", CancellationToken.None);

        result.Should().BeOfType<UnauthorizedObjectResult>()
            .Or.BeOfType<UnauthorizedResult>();
    }

    [Fact]
    public async Task Ping_ValidHmac_Returns200()
    {
        var (ctrl, verifierMock) = Build();
        var orgId = Guid.NewGuid();

        verifierMock
            .Setup(v => v.VerifyAsync(
                It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>(),
                It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new HmacVerificationResult(true, null, orgId));

        ctrl.Request.Headers["X-ProcuLink-Timestamp"] = DateTimeOffset.UtcNow.ToString("o");
        ctrl.Request.Headers["X-ProcuLink-Nonce"]     = Guid.NewGuid().ToString();
        ctrl.Request.Headers["X-ProcuLink-Signature"] = "aabbcc";
        ctrl.Request.Body = new MemoryStream(System.Text.Encoding.UTF8.GetBytes("{}"));

        var result = await ctrl.Ping("test-slug", CancellationToken.None);

        result.Should().BeOfType<OkObjectResult>().Or.BeOfType<OkResult>();
    }
}
```

Note: read the actual `WebhookIngressController` constructor and endpoint signatures before writing. `HmacVerificationResult` is a record — check the actual constructor signature (it might be `(Valid, ErrorMessage, OrganisationId)` or use `init` setters). Adapt the mock setup to the real signature.

- [ ] **Step 5.5 — Create `BillingControllerTests.cs`** (Stripe signature verification)

Read `BillingController.cs:154-190` (the `Webhook` method) to understand the `Stripe.EventUtility.ConstructEvent` call. The Stripe SDK signature check uses a real HMAC — for unit tests, mock the `IBillingService` instead and test the controller logic around the Stripe event handling rather than the Stripe SDK internals.

Create `ProcuLink.Api.Tests/Controllers/BillingControllerTests.cs`:

```csharp
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using ProcuLink.Api.Controllers;
using ProcuLink.Core.Services;
using ProcuLink.Core.Services.Ai;
using ProcuLink.Infrastructure;
using Xunit;

namespace ProcuLink.Api.Tests.Controllers;

public class BillingControllerTests
{
    private static ProcuLinkDbContext MakeDb() =>
        new(new DbContextOptionsBuilder<ProcuLinkDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options);

    private static BillingController Build(
        IBillingService? billing = null,
        ICurrentTenantService? tenant = null,
        IConfiguration? config = null,
        ProcuLinkDbContext? db = null)
    {
        billing ??= new Mock<IBillingService>().Object;
        db      ??= MakeDb();

        var tenantMock = new Mock<ICurrentTenantService>();
        tenantMock.SetupGet(t => t.OrganisationId).Returns(Guid.NewGuid());
        tenant ??= tenantMock.Object;

        config ??= new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Stripe:WebhookSecret"] = "whsec_test_placeholder",
            })
            .Build();

        var aiUsage = new Mock<IAiUsageTracker>().Object;

        var ctrl = new BillingController(
            billing, tenant, config,
            NullLogger<BillingController>.Instance,
            db, aiUsage);

        ctrl.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext(),
        };

        return ctrl;
    }

    [Fact]
    public async Task Webhook_MissingSignatureHeader_Returns400()
    {
        var ctrl = Build();
        ctrl.Request.Body = new MemoryStream(System.Text.Encoding.UTF8.GetBytes("{}"));
        // No Stripe-Signature header set

        var result = await ctrl.Webhook(CancellationToken.None);

        // Stripe EventUtility throws on missing signature → BadRequest
        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task Webhook_InvalidSignature_Returns400()
    {
        var ctrl = Build();
        ctrl.Request.Headers["Stripe-Signature"] = "t=1234,v1=invalidsig";
        ctrl.Request.Body = new MemoryStream(System.Text.Encoding.UTF8.GetBytes("{}"));

        var result = await ctrl.Webhook(CancellationToken.None);

        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task GetStatus_ReturnsOkWithBillingInfo()
    {
        var billing = new Mock<IBillingService>();
        billing.Setup(b => b.GetStatusAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()))
               .ReturnsAsync(new BillingStatus(
                   Plan: "pilot", AccountStatus: "trialing",
                   OrdersThisMonth: 0, OrderLimit: 20,
                   SuppliersUsed: 0, SupplierLimit: 1,
                   TrialStartedAt: null, TrialEndsAt: null,
                   IsTrialExpired: false, IsOrderLimitReached: false,
                   IsSupplierLimitReached: false, CanProcessOrders: true,
                   CanAddSupplier: true));

        var ctrl = Build(billing: billing.Object);

        var result = await ctrl.GetStatus(CancellationToken.None);

        result.Should().BeOfType<OkObjectResult>();
    }
}
```

Note: `BillingStatus` may be a class/record with different constructor args — read the actual definition and adapt. `GetStatus` endpoint might be named differently — read the actual controller method.

- [ ] **Step 5.6 — Run new tests**
```bash
cd "C:\Users\Dmitri.MARKIT\source\repos\ProcuLink"
dotnet test ProcuLink.Api.Tests/ProcuLink.Api.Tests.csproj \
  --filter "FullyQualifiedName~BillingControllerTests|FullyQualifiedName~WebhookIngressControllerTests|FullyQualifiedName~ApiKeyControllerTests" \
  -v minimal 2>&1 | tail -20
```
Expected: all pass.

- [ ] **Step 5.7 — Full suite**
```bash
dotnet test --configuration Release 2>&1 | tail -8
```

- [ ] **Step 5.8 — Commit and push**
```bash
git add ProcuLink.Api.Tests/Controllers/BillingControllerTests.cs \
        ProcuLink.Api.Tests/Controllers/WebhookIngressControllerTests.cs \
        ProcuLink.Api.Tests/Controllers/ApiKeyControllerTests.cs
git commit -m "test: controller coverage for BillingController (Stripe webhook), WebhookIngressController (HMAC), ApiKeyController"
git push origin main
```

---

## Self-Review

**Spec coverage vs Wave 2 roadmap:**

| Item | Task |
|---|---|
| Hangfire queue segregation | Task 1 |
| mapping_corrections + AppliedCount | Task 2 |
| po_passport_events ledger | Task 3 |
| buyer_name column + SQL search | Task 4 |
| Controller tests (Billing, Webhook, ApiKey) | Task 5 |
| order_exceptions table + Exception Ops UI | ← deferred (L effort, needs design) |
| Supplier Acceptance Profile versioning | ← deferred (L effort, needs design) |

**Collision avoidance:** Pull → implement → push in strict sequence. Tasks 2, 3, 4 each generate exactly one migration and push before the next runs. No parallel subagents.

**Placeholder scan:** All code blocks are complete. Task 5 notes warn the implementer to read actual constructor signatures before using template code — this is intentional, not a placeholder (controller constructors are complex and the templates show the pattern, not a verbatim copy).

**Task 4 ILike caveat:** `EF.Functions.ILike` is PostgreSQL-only and throws on the in-memory EF provider used in most unit tests. Step 4.8 explicitly calls this out and tells the implementer to adapt search tests accordingly. This is a known trade-off for SQL-native search.
