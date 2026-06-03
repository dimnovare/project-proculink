# Wave 2 Moat: Exception Ops + Supplier Acceptance Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship two first-class product subsystems the audit flagged as the moat: a durable Exception Ops queue (lean v1) and a versioned Supplier Acceptance Profile with rule-based order validation.

**Architecture:** Backend-first in `C:\Users\Dmitri.MARKIT\source\repos\ProcuLink` (entities → DbContext → migration → service → controller → tests), then frontend in `C:\Users\Dmitri.MARKIT\source\repos\project-proculink`. Two migrations (T1 exceptions, T4 acceptance) run in strict sequence — pull/push between tasks to avoid migration conflicts. Exception generation is centralised in one idempotent `ReconcileAsync` so callers never hand-craft exception rows.

**Tech Stack:** ASP.NET Core 8 / EF Core 8 / PostgreSQL / xUnit + Moq (backend); Next.js 15 / TypeScript / TanStack Query (frontend).

**Decisions locked:** One combined plan. Exception Ops = lean v1 (table + auto-generation + list/resolve/ignore API + `/operations/exceptions` page; NO assignee/SLA). Acceptance Profile = new versioned rule tables (`supplier_acceptance_profiles` + `supplier_acceptance_rules` + `order_validation_results`).

---

## File Map

### Backend — Exception Ops
| Action | File | Task |
|---|---|---|
| Create | `ProcuLink.Core/Entities/OrderException.cs` | T1 |
| Modify | `ProcuLink.Infrastructure/ProcuLinkDbContext.cs` | T1 |
| Create | migration `Wave2OrderExceptions` | T1 |
| Create | `ProcuLink.Core/Services/IOrderExceptionService.cs` | T2 |
| Create | `ProcuLink.Api/Services/OrderExceptionService.cs` | T2 |
| Modify | `ProcuLink.Api/Services/OrderService.cs` (Reconcile calls) | T2 |
| Modify | `ProcuLink.Api/Program.cs` + `ProcuLink.Worker/Program.cs` (DI) | T2 |
| Create | `ProcuLink.Api.Tests/Services/OrderExceptionServiceTests.cs` | T2 |
| Create | `ProcuLink.Api/Controllers/ExceptionsController.cs` | T3 |
| Create | `ProcuLink.Api/Contracts/OrderExceptionDto.cs` | T3 |
| Create | `ProcuLink.Api.Tests/Controllers/ExceptionsControllerTests.cs` | T3 |

### Backend — Acceptance Profile
| Action | File | Task |
|---|---|---|
| Create | `ProcuLink.Core/Entities/SupplierAcceptanceProfile.cs` | T4 |
| Create | `ProcuLink.Core/Entities/SupplierAcceptanceRule.cs` | T4 |
| Create | `ProcuLink.Core/Entities/OrderValidationResult.cs` | T4 |
| Modify | `ProcuLink.Infrastructure/ProcuLinkDbContext.cs` | T4 |
| Create | migration `Wave2AcceptanceProfiles` | T4 |
| Create | `ProcuLink.Core/Services/ISupplierAcceptanceService.cs` | T5 |
| Create | `ProcuLink.Api/Services/SupplierAcceptanceService.cs` | T5 |
| Modify | `ProcuLink.Api/Program.cs` + `ProcuLink.Worker/Program.cs` (DI) | T5 |
| Create | `ProcuLink.Api.Tests/Services/SupplierAcceptanceServiceTests.cs` | T5 |
| Create | `ProcuLink.Api/Controllers/SupplierAcceptanceController.cs` | T6 |
| Create | `ProcuLink.Api/Contracts/AcceptanceProfileDto.cs` | T6 |
| Modify | `ProcuLink.Api/Controllers/OrdersController.cs` (validate endpoint) | T6 |
| Modify | `ProcuLink.Api/Services/PassportService.cs` (populate validationResults) | T6 |
| Create | `ProcuLink.Api.Tests/Controllers/SupplierAcceptanceControllerTests.cs` | T6 |

### Frontend
| Action | File | Task |
|---|---|---|
| Modify | `src/types/procurement.ts` (exception + acceptance types) | T7, T8 |
| Modify | `src/lib/api-client.ts` (exception + acceptance functions) | T7, T8 |
| Create | `src/app/(app)/operations/exceptions/page.tsx` | T7 |
| Create | `src/components/bridge/ExceptionsView.tsx` | T7 |
| Modify | `src/components/bridge/SupplierDockProfile.tsx` (Acceptance tab) | T8 |
| Modify | `src/components/bridge/SpineReview.tsx` (validation results panel) | T8 |

---

## Task 1 — OrderException entity + migration

**Repo:** `C:\Users\Dmitri.MARKIT\source\repos\ProcuLink`

**Context:** Exceptions are currently inferred from order status at read time. This adds a durable, queryable `order_exceptions` table. Lean v1: state machine is `open → resolved | ignored`. No assignee, no SLA deadline.

- [ ] **Step 1.1 — Pull and check migrations**
```bash
cd "C:\Users\Dmitri.MARKIT\source\repos\ProcuLink"
git pull origin main
ls ProcuLink.Infrastructure/Migrations/ | tail -3
```
If a migration appeared that you didn't create, report NEEDS_CONTEXT.

- [ ] **Step 1.2 — Create `OrderException.cs`**

Create `ProcuLink.Core/Entities/OrderException.cs`:
```csharp
namespace ProcuLink.Core.Entities;

/// <summary>
/// A durable, operator-workable exception raised against a purchase order.
/// Lean v1: state is open | resolved | ignored. No assignee or SLA yet.
/// Generated idempotently by OrderExceptionService.ReconcileAsync from order state.
/// </summary>
public class OrderException
{
    public Guid     Id         { get; set; }
    public Guid     OrgId      { get; set; }
    public Guid     OrderId    { get; set; }
    public Guid?    LineId     { get; set; }
    /// <summary>Parse | Validate | Map | Transform | Deliver</summary>
    public string   Stage      { get; set; } = string.Empty;
    /// <summary>unresolved_mapping | transform_failed | delivery_failed | supplier_rejected | dead_letter | validation_error</summary>
    public string   Code       { get; set; } = string.Empty;
    /// <summary>info | warning | error | critical</summary>
    public string   Severity   { get; set; } = "warning";
    /// <summary>open | resolved | ignored</summary>
    public string   State      { get; set; } = "open";
    public string   Message    { get; set; } = string.Empty;
    public DateTime CreatedAt  { get; set; }
    public DateTime? ResolvedAt { get; set; }

    // Navigation
    public Organisation Organisation { get; set; } = null!;
}
```

- [ ] **Step 1.3 — Register in `ProcuLinkDbContext.cs`**

Read `ProcuLink.Infrastructure/ProcuLinkDbContext.cs`. Add `public DbSet<OrderException> OrderExceptions { get; set; } = null!;` to the DbSet list. Add this EF config block in `OnModelCreating` (place it after the `audit_events` block):

```csharp
        // ── order_exceptions ───────────────────────────────────────────
        modelBuilder.Entity<OrderException>(b =>
        {
            b.ToTable("order_exceptions");
            b.HasKey(x => x.Id);
            b.Property(x => x.Id).HasColumnName("id");
            b.Property(x => x.OrgId).HasColumnName("org_id");
            b.Property(x => x.OrderId).HasColumnName("order_id");
            b.Property(x => x.LineId).HasColumnName("line_id");
            b.Property(x => x.Stage).HasColumnName("stage").IsRequired();
            b.Property(x => x.Code).HasColumnName("code").IsRequired();
            b.Property(x => x.Severity).HasColumnName("severity").IsRequired();
            b.Property(x => x.State).HasColumnName("state").IsRequired();
            b.Property(x => x.Message).HasColumnName("message").IsRequired();
            b.Property(x => x.CreatedAt).HasColumnName("created_at").HasColumnType("timestamptz");
            b.Property(x => x.ResolvedAt).HasColumnName("resolved_at").HasColumnType("timestamptz");
            b.HasOne(x => x.Organisation).WithMany().HasForeignKey(x => x.OrgId);
            b.HasIndex(x => new { x.OrgId, x.State, x.Severity, x.CreatedAt })
             .HasDatabaseName("IX_order_exceptions_org_id_state_severity_created_at");
            b.HasIndex(x => new { x.OrgId, x.OrderId })
             .HasDatabaseName("IX_order_exceptions_org_id_order_id");
        });
```

- [ ] **Step 1.4 — Build + generate migration**
```bash
dotnet build ProcuLink.slnx --no-restore 2>&1 | tail -5
dotnet ef migrations add Wave2OrderExceptions \
  --project ProcuLink.Infrastructure --startup-project ProcuLink.Api 2>&1 | tail -5
```
Inspect: `Up()` must have `CreateTable("order_exceptions", ...)` with the two indexes.

- [ ] **Step 1.5 — Full test suite**
```bash
dotnet test --configuration Release 2>&1 | tail -8
```

- [ ] **Step 1.6 — Commit and push**
```bash
git add ProcuLink.Core/Entities/OrderException.cs \
        ProcuLink.Infrastructure/ProcuLinkDbContext.cs \
        ProcuLink.Infrastructure/Migrations/
git commit -m "feat(exceptions): order_exceptions table (lean v1 — open/resolved/ignored)"
git push origin main
```

---

## Task 2 — OrderExceptionService (idempotent Reconcile) + wiring

**Repo:** `C:\Users\Dmitri.MARKIT\source\repos\ProcuLink`

**Context:** All exception generation flows through one idempotent `ReconcileAsync(orgId, orderId)` that compares current order state against open exceptions, opening new ones and auto-resolving cleared ones. Callers never construct exceptions directly. `ResolveAsync` / `IgnoreAsync` handle operator actions.

- [ ] **Step 2.1 — Pull latest**
```bash
cd "C:\Users\Dmitri.MARKIT\source\repos\ProcuLink"
git pull origin main
```

- [ ] **Step 2.2 — Create `IOrderExceptionService.cs`**

Create `ProcuLink.Core/Services/IOrderExceptionService.cs`:
```csharp
using ProcuLink.Core.Entities;

namespace ProcuLink.Core.Services;

public interface IOrderExceptionService
{
    /// <summary>
    /// Idempotently reconcile open exceptions for an order against its current
    /// status and lines: open new exceptions for current problems, auto-resolve
    /// open exceptions whose problem no longer applies. Never touches ignored rows.
    /// </summary>
    Task ReconcileAsync(Guid orgId, Guid orderId, CancellationToken ct);

    Task<IReadOnlyList<OrderException>> ListAsync(Guid orgId, string? state, CancellationToken ct);
    Task<IReadOnlyList<OrderException>> ListForOrderAsync(Guid orgId, Guid orderId, CancellationToken ct);

    /// <summary>Returns false when the exception does not exist for this org.</summary>
    Task<bool> ResolveAsync(Guid orgId, Guid exceptionId, CancellationToken ct);
    Task<bool> IgnoreAsync(Guid orgId, Guid exceptionId, CancellationToken ct);
}
```

- [ ] **Step 2.3 — Create `OrderExceptionService.cs`**

Create `ProcuLink.Api/Services/OrderExceptionService.cs`:
```csharp
using Microsoft.EntityFrameworkCore;
using ProcuLink.Core.Constants;
using ProcuLink.Core.Entities;
using ProcuLink.Core.Services;
using ProcuLink.Infrastructure;

namespace ProcuLink.Api.Services;

public sealed class OrderExceptionService : IOrderExceptionService
{
    private readonly ProcuLinkDbContext _db;

    public OrderExceptionService(ProcuLinkDbContext db) => _db = db;

    /// <summary>(code, stage, severity, message) for a problem currently present on an order.</summary>
    private static (string Code, string Stage, string Severity, string Message)? ProblemFor(
        string status, bool hasUnresolvedLines)
    {
        if (status == OrderStatusConstants.PendingReview || hasUnresolvedLines)
            return ("unresolved_mapping", "Map", "warning", "Order has lines that need a supplier item code.");
        if (status == OrderStatusConstants.TransformFailed)
            return ("transform_failed", "Transform", "error", "Transform failed for this order.");
        if (status == OrderStatusConstants.DeliveryFailed)
            return ("delivery_failed", "Deliver", "error", "Delivery to the supplier failed.");
        if (status == OrderStatusConstants.RejectedBySupplier)
            return ("supplier_rejected", "Deliver", "error", "The supplier rejected this order.");
        if (status == OrderStatusConstants.DeliveryDeadLetter)
            return ("dead_letter", "Deliver", "critical", "Delivery retries are exhausted (dead-letter).");
        return null;
    }

    public async Task ReconcileAsync(Guid orgId, Guid orderId, CancellationToken ct)
    {
        var order = await _db.PurchaseOrders
            .Include(o => o.Lines)
            .Where(o => o.Id == orderId && o.OrgId == orgId)
            .FirstOrDefaultAsync(ct);
        if (order is null) return;

        var hasUnresolved = order.Lines.Any(l => l.NeedsReview);
        var problem       = ProblemFor(order.Status, hasUnresolved);

        var openExceptions = await _db.OrderExceptions
            .Where(e => e.OrgId == orgId && e.OrderId == orderId && e.State == "open")
            .ToListAsync(ct);

        var now = DateTime.UtcNow;

        // Auto-resolve open exceptions whose problem no longer applies.
        foreach (var ex in openExceptions)
        {
            if (problem is null || ex.Code != problem.Value.Code)
            {
                ex.State      = "resolved";
                ex.ResolvedAt = now;
            }
        }

        // Open a new exception for the current problem if none is open with that code.
        if (problem is not null &&
            !openExceptions.Any(e => e.Code == problem.Value.Code && e.State == "open"))
        {
            _db.OrderExceptions.Add(new OrderException
            {
                Id        = Guid.NewGuid(),
                OrgId     = orgId,
                OrderId   = orderId,
                Stage     = problem.Value.Stage,
                Code      = problem.Value.Code,
                Severity  = problem.Value.Severity,
                State     = "open",
                Message   = problem.Value.Message,
                CreatedAt = now,
            });
        }

        await _db.SaveChangesAsync(ct);
    }

    public async Task<IReadOnlyList<OrderException>> ListAsync(Guid orgId, string? state, CancellationToken ct)
    {
        var q = _db.OrderExceptions.AsNoTracking().Where(e => e.OrgId == orgId);
        if (!string.IsNullOrWhiteSpace(state))
            q = q.Where(e => e.State == state);
        return await q
            .OrderByDescending(e => e.CreatedAt)
            .ToListAsync(ct);
    }

    public async Task<IReadOnlyList<OrderException>> ListForOrderAsync(Guid orgId, Guid orderId, CancellationToken ct) =>
        await _db.OrderExceptions.AsNoTracking()
            .Where(e => e.OrgId == orgId && e.OrderId == orderId)
            .OrderByDescending(e => e.CreatedAt)
            .ToListAsync(ct);

    public async Task<bool> ResolveAsync(Guid orgId, Guid exceptionId, CancellationToken ct)
        => await SetStateAsync(orgId, exceptionId, "resolved", ct);

    public async Task<bool> IgnoreAsync(Guid orgId, Guid exceptionId, CancellationToken ct)
        => await SetStateAsync(orgId, exceptionId, "ignored", ct);

    private async Task<bool> SetStateAsync(Guid orgId, Guid exceptionId, string state, CancellationToken ct)
    {
        var ex = await _db.OrderExceptions
            .Where(e => e.Id == exceptionId && e.OrgId == orgId)
            .FirstOrDefaultAsync(ct);
        if (ex is null) return false;
        ex.State      = state;
        ex.ResolvedAt = state == "resolved" ? DateTime.UtcNow : ex.ResolvedAt;
        await _db.SaveChangesAsync(ct);
        return true;
    }
}
```

- [ ] **Step 2.4 — Register DI in both `Program.cs` files**

In `ProcuLink.Api/Program.cs` and `ProcuLink.Worker/Program.cs`, near the other `AddScoped<IOrderService, OrderService>()` registrations, add:
```csharp
builder.Services.AddScoped<IOrderExceptionService, OrderExceptionService>();
```
(Worker needs it because OrderService — which the worker uses — will depend on it.)

- [ ] **Step 2.5 — Inject + call Reconcile from `OrderService.cs`**

Read `OrderService.cs`. Add `IOrderExceptionService _exceptions` to the constructor (field + param + assignment), following the existing `_mappings` injection pattern.

Add `await _exceptions.ReconcileAsync(organisationId, orderId, ct);` (or `entity.Id` / `stub.Id` as appropriate) at the END of these methods, after their final SaveChanges / passport emit, before the `return Result...Ok(...)`:
- `ParseStoredFileAsync` (both success and failure exits — after status is set)
- `ResolveAsync` (after the transaction commits)
- `AcceptAiSuggestionsAsync` (after save)
- `MarkRejectedAsync` (after save — order becomes rejected_by_supplier)

For `ResolveAsync`, place the Reconcile call AFTER `tx.CommitAsync` so it sees committed state (it opens its own SaveChanges; that's fine — it's a separate concern from the resolve transaction).

- [ ] **Step 2.6 — Wire delivery-side status changes**

Search for where delivery statuses are written:
```bash
grep -rn "DeliveryFailed\|DeliveryDeadLetter\|Status = \"delivered\"\|OrderStatusConstants.Delivered" ProcuLink.Infrastructure/Services/DeliveryService.cs ProcuLink.Api/Jobs/ ProcuLink.Infrastructure/Jobs/ --include="*.cs" | head -20
```
In `DeliveryService` (and `RetryDeliveryJob` if it sets dead-letter), after each status write + SaveChanges, call `_exceptions.ReconcileAsync(orgId, orderId, ct)`. Inject `IOrderExceptionService` into `DeliveryService` the same way. If `DeliveryService` is in `ProcuLink.Infrastructure` and `OrderExceptionService` is in `ProcuLink.Api`, that's a project-reference problem — in that case, MOVE `OrderExceptionService` to `ProcuLink.Infrastructure/Services/` (and keep `IOrderExceptionService` in Core). Check the project the existing `OrderService` lives in and match it; if `DeliveryService` cannot see the Api project, the service must live in Infrastructure. Decide based on the actual project references and report which you chose.

- [ ] **Step 2.7 — Write tests**

Create `ProcuLink.Api.Tests/Services/OrderExceptionServiceTests.cs`:
```csharp
using Microsoft.EntityFrameworkCore;
using ProcuLink.Core.Entities;
using ProcuLink.Infrastructure;
using ProcuLink.Api.Services;   // adjust if you moved the service to Infrastructure
using Xunit;

namespace ProcuLink.Api.Tests.Services;

public class OrderExceptionServiceTests
{
    private static ProcuLinkDbContext MakeDb() =>
        new(new DbContextOptionsBuilder<ProcuLinkDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options);

    private static (Guid orgId, Guid orderId) SeedOrder(ProcuLinkDbContext db, string status, bool unresolvedLine)
    {
        var orgId = Guid.NewGuid();
        var orderId = Guid.NewGuid();
        db.PurchaseOrders.Add(new PurchaseOrderEntity
        {
            Id = orderId, OrgId = orgId, SupplierId = Guid.NewGuid(),
            PoNumber = "PO-1", Status = status, Currency = "EUR",
            OrderDate = DateOnly.FromDateTime(DateTime.UtcNow),
            CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
            Lines = new List<PurchaseOrderLineEntity>
            {
                new() { Id = Guid.NewGuid(), OrderId = orderId, LineNumber = 1,
                        BuyerItemCode = "B1", NeedsReview = unresolvedLine, Quantity = 1, UnitPrice = 1 }
            }
        });
        db.SaveChanges();
        return (orgId, orderId);
    }

    [Fact]
    public async Task Reconcile_PendingReview_OpensUnresolvedMappingException()
    {
        var db = MakeDb();
        var (orgId, orderId) = SeedOrder(db, "pending_review", unresolvedLine: true);
        var svc = new OrderExceptionService(db);

        await svc.ReconcileAsync(orgId, orderId, CancellationToken.None);

        var ex = await db.OrderExceptions.SingleAsync();
        Assert.Equal("unresolved_mapping", ex.Code);
        Assert.Equal("open", ex.State);
    }

    [Fact]
    public async Task Reconcile_IsIdempotent_NoDuplicateOpenException()
    {
        var db = MakeDb();
        var (orgId, orderId) = SeedOrder(db, "pending_review", unresolvedLine: true);
        var svc = new OrderExceptionService(db);

        await svc.ReconcileAsync(orgId, orderId, CancellationToken.None);
        await svc.ReconcileAsync(orgId, orderId, CancellationToken.None);

        Assert.Equal(1, await db.OrderExceptions.CountAsync(e => e.State == "open"));
    }

    [Fact]
    public async Task Reconcile_ProblemCleared_AutoResolvesOpenException()
    {
        var db = MakeDb();
        var (orgId, orderId) = SeedOrder(db, "pending_review", unresolvedLine: true);
        var svc = new OrderExceptionService(db);
        await svc.ReconcileAsync(orgId, orderId, CancellationToken.None);

        // Order becomes ready, line resolved
        var order = await db.PurchaseOrders.Include(o => o.Lines).SingleAsync();
        order.Status = "ready";
        order.Lines[0].NeedsReview = false;
        await db.SaveChangesAsync();

        await svc.ReconcileAsync(orgId, orderId, CancellationToken.None);

        Assert.Equal(0, await db.OrderExceptions.CountAsync(e => e.State == "open"));
        Assert.Equal(1, await db.OrderExceptions.CountAsync(e => e.State == "resolved"));
    }

    [Fact]
    public async Task Resolve_SetsStateResolved()
    {
        var db = MakeDb();
        var (orgId, orderId) = SeedOrder(db, "delivery_failed", unresolvedLine: false);
        var svc = new OrderExceptionService(db);
        await svc.ReconcileAsync(orgId, orderId, CancellationToken.None);
        var ex = await db.OrderExceptions.SingleAsync();

        var ok = await svc.ResolveAsync(orgId, ex.Id, CancellationToken.None);

        Assert.True(ok);
        Assert.Equal("resolved", (await db.OrderExceptions.SingleAsync()).State);
    }
}
```

- [ ] **Step 2.8 — Run tests then full suite**
```bash
cd "C:\Users\Dmitri.MARKIT\source\repos\ProcuLink"
dotnet test ProcuLink.Api.Tests/ProcuLink.Api.Tests.csproj --filter "FullyQualifiedName~OrderExceptionServiceTests" -v minimal 2>&1 | tail -10
dotnet test --configuration Release 2>&1 | tail -8
```

- [ ] **Step 2.9 — Commit and push**
```bash
git add ProcuLink.Core/Services/IOrderExceptionService.cs \
        ProcuLink.Api/Services/OrderExceptionService.cs \
        ProcuLink.Infrastructure/Services/OrderExceptionService.cs \
        ProcuLink.Api/Services/OrderService.cs \
        ProcuLink.Infrastructure/Services/DeliveryService.cs \
        ProcuLink.Api/Program.cs ProcuLink.Worker/Program.cs \
        ProcuLink.Api.Tests/Services/OrderExceptionServiceTests.cs
git commit -m "feat(exceptions): idempotent ReconcileAsync generation + resolve/ignore, wired into order lifecycle"
git push origin main
```
(`git add` both possible service locations — only the one you created exists; git ignores the missing path with a warning, which is fine. Or list only the path you used.)

---

## Task 3 — ExceptionsController

**Repo:** `C:\Users\Dmitri.MARKIT\source\repos\ProcuLink`

- [ ] **Step 3.1 — Pull latest**
```bash
cd "C:\Users\Dmitri.MARKIT\source\repos\ProcuLink"
git pull origin main
```

- [ ] **Step 3.2 — Create `OrderExceptionDto.cs`**

Create `ProcuLink.Api/Contracts/OrderExceptionDto.cs`:
```csharp
namespace ProcuLink.Api.Contracts;

public record OrderExceptionDto(
    Guid     Id,
    Guid     OrderId,
    Guid?    LineId,
    string   Stage,
    string   Code,
    string   Severity,
    string   State,
    string   Message,
    DateTime CreatedAt,
    DateTime? ResolvedAt
);
```

- [ ] **Step 3.3 — Create `ExceptionsController.cs`**

Create `ProcuLink.Api/Controllers/ExceptionsController.cs` (follow the `DeliveriesController` pattern — `[Authorize]`, `ICurrentTenantService`):
```csharp
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ProcuLink.Api.Contracts;
using ProcuLink.Core.Services;

namespace ProcuLink.Api.Controllers;

[Authorize]
[ApiController]
[Route("api/exceptions")]
public sealed class ExceptionsController : ControllerBase
{
    private readonly IOrderExceptionService _exceptions;
    private readonly ICurrentTenantService  _tenant;

    public ExceptionsController(IOrderExceptionService exceptions, ICurrentTenantService tenant)
    {
        _exceptions = exceptions;
        _tenant     = tenant;
    }

    [HttpGet]
    [ProducesResponseType(typeof(IReadOnlyList<OrderExceptionDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> List([FromQuery] string? state, CancellationToken ct)
    {
        var rows = await _exceptions.ListAsync(_tenant.OrganisationId, state, ct);
        return Ok(rows.Select(ToDto));
    }

    [HttpPatch("{id:guid}/resolve")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Resolve(Guid id, CancellationToken ct)
        => await _exceptions.ResolveAsync(_tenant.OrganisationId, id, ct) ? NoContent() : NotFound();

    [HttpPatch("{id:guid}/ignore")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Ignore(Guid id, CancellationToken ct)
        => await _exceptions.IgnoreAsync(_tenant.OrganisationId, id, ct) ? NoContent() : NotFound();

    private static OrderExceptionDto ToDto(Core.Entities.OrderException e) => new(
        e.Id, e.OrderId, e.LineId, e.Stage, e.Code, e.Severity, e.State, e.Message, e.CreatedAt, e.ResolvedAt);
}
```

Also add a per-order endpoint to `OrdersController.cs` (`GET /api/orders/{id}/exceptions`):
```csharp
    [HttpGet("{id:guid}/exceptions")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> GetExceptions(Guid id, CancellationToken ct)
    {
        var rows = await _exceptionService.ListForOrderAsync(_tenant.OrganisationId, id, ct);
        return Ok(rows);
    }
```
This requires injecting `IOrderExceptionService _exceptionService` into `OrdersController` (add field, constructor param, assignment).

- [ ] **Step 3.4 — Write controller tests**

Create `ProcuLink.Api.Tests/Controllers/ExceptionsControllerTests.cs` using `Mock<IOrderExceptionService>` + `Mock<ICurrentTenantService>`:
- `List_ReturnsOk_WithMappedDtos` (mock returns 2 rows → assert OkObjectResult)
- `Resolve_Returns204_WhenServiceReturnsTrue`
- `Resolve_Returns404_WhenServiceReturnsFalse`
- `Ignore_Returns204_WhenServiceReturnsTrue`

Follow the `ApiKeyControllerTests` pattern (pure mock, no DbContext needed). Read that test file for the exact structure.

- [ ] **Step 3.5 — Build + test**
```bash
dotnet build ProcuLink.slnx --no-restore 2>&1 | tail -5
dotnet test --configuration Release 2>&1 | tail -8
```

- [ ] **Step 3.6 — Commit and push**
```bash
git add ProcuLink.Api/Contracts/OrderExceptionDto.cs \
        ProcuLink.Api/Controllers/ExceptionsController.cs \
        ProcuLink.Api/Controllers/OrdersController.cs \
        ProcuLink.Api.Tests/Controllers/ExceptionsControllerTests.cs
git commit -m "feat(exceptions): /api/exceptions list/resolve/ignore + /api/orders/{id}/exceptions"
git push origin main
```

---

## Task 4 — Acceptance Profile entities + migration

**Repo:** `C:\Users\Dmitri.MARKIT\source\repos\ProcuLink`

**Context:** Three new tables for the versioned acceptance profile: the profile (versioned), its rules, and per-order validation results. Distinct from the legacy `supplier_profiles` table (which stays for output/destination config).

- [ ] **Step 4.1 — Pull latest**
```bash
cd "C:\Users\Dmitri.MARKIT\source\repos\ProcuLink"
git pull origin main
ls ProcuLink.Infrastructure/Migrations/ | tail -3
```

- [ ] **Step 4.2 — Create the three entities**

`ProcuLink.Core/Entities/SupplierAcceptanceProfile.cs`:
```csharp
namespace ProcuLink.Core.Entities;

/// <summary>
/// A versioned definition of what a supplier will accept on a PO.
/// Multiple versions per (org, supplier); exactly one is Active at a time.
/// </summary>
public class SupplierAcceptanceProfile
{
    public Guid     Id            { get; set; }
    public Guid     OrgId         { get; set; }
    public Guid     SupplierId    { get; set; }
    public int      VersionNo     { get; set; }
    /// <summary>draft | active | archived</summary>
    public string   Status        { get; set; } = "draft";
    public string?  Protocol      { get; set; }
    public string?  OutputFormat  { get; set; }
    public DateTime? EffectiveFrom { get; set; }
    public DateTime? EffectiveTo   { get; set; }
    public string?  CreatedBy     { get; set; }
    public DateTime CreatedAt     { get; set; }

    public List<SupplierAcceptanceRule> Rules { get; set; } = new();
    public Organisation Organisation { get; set; } = null!;
}
```

`ProcuLink.Core/Entities/SupplierAcceptanceRule.cs`:
```csharp
namespace ProcuLink.Core.Entities;

/// <summary>One structured acceptance rule inside a profile version.</summary>
public class SupplierAcceptanceRule
{
    public Guid    Id            { get; set; }
    public Guid    ProfileId     { get; set; }
    /// <summary>order | line</summary>
    public string  Scope         { get; set; } = "line";
    /// <summary>e.g. supplierItemCode, quantity, unitPrice, currency, buyerName</summary>
    public string  FieldPath     { get; set; } = string.Empty;
    /// <summary>required | equals | in | min | max</summary>
    public string  Operator      { get; set; } = "required";
    public string? ExpectedValue { get; set; }
    /// <summary>warning | error</summary>
    public string  Severity      { get; set; } = "error";
    public bool    BlockOnFail   { get; set; }

    public SupplierAcceptanceProfile Profile { get; set; } = null!;
}
```

`ProcuLink.Core/Entities/OrderValidationResult.cs`:
```csharp
namespace ProcuLink.Core.Entities;

/// <summary>Persisted outcome of evaluating one rule against one order (or line).</summary>
public class OrderValidationResult
{
    public Guid     Id         { get; set; }
    public Guid     OrgId      { get; set; }
    public Guid     OrderId    { get; set; }
    public Guid?    ProfileId  { get; set; }
    public Guid?    RuleId     { get; set; }
    public int?     LineNumber { get; set; }
    /// <summary>info | warning | error</summary>
    public string   Severity   { get; set; } = "error";
    /// <summary>pass | fail</summary>
    public string   Status     { get; set; } = "pass";
    public string   Code       { get; set; } = string.Empty;
    public string   Message    { get; set; } = string.Empty;
    public DateTime DetectedAt { get; set; }

    public Organisation Organisation { get; set; } = null!;
}
```

- [ ] **Step 4.3 — Register in `ProcuLinkDbContext.cs`**

Add three DbSets. Add three EF config blocks:

```csharp
        // ── supplier_acceptance_profiles ────────────────────────────────
        modelBuilder.Entity<SupplierAcceptanceProfile>(b =>
        {
            b.ToTable("supplier_acceptance_profiles");
            b.HasKey(x => x.Id);
            b.Property(x => x.Id).HasColumnName("id");
            b.Property(x => x.OrgId).HasColumnName("org_id");
            b.Property(x => x.SupplierId).HasColumnName("supplier_id");
            b.Property(x => x.VersionNo).HasColumnName("version_no");
            b.Property(x => x.Status).HasColumnName("status").IsRequired();
            b.Property(x => x.Protocol).HasColumnName("protocol");
            b.Property(x => x.OutputFormat).HasColumnName("output_format");
            b.Property(x => x.EffectiveFrom).HasColumnName("effective_from").HasColumnType("timestamptz");
            b.Property(x => x.EffectiveTo).HasColumnName("effective_to").HasColumnType("timestamptz");
            b.Property(x => x.CreatedBy).HasColumnName("created_by");
            b.Property(x => x.CreatedAt).HasColumnName("created_at").HasColumnType("timestamptz");
            b.HasOne(x => x.Organisation).WithMany().HasForeignKey(x => x.OrgId);
            b.HasMany(x => x.Rules).WithOne(r => r.Profile).HasForeignKey(r => r.ProfileId);
            b.HasIndex(x => new { x.OrgId, x.SupplierId, x.VersionNo })
             .IsUnique()
             .HasDatabaseName("IX_supplier_acceptance_profiles_org_supplier_version");
            b.HasIndex(x => new { x.OrgId, x.SupplierId, x.Status })
             .HasDatabaseName("IX_supplier_acceptance_profiles_org_supplier_status");
        });

        // ── supplier_acceptance_rules ───────────────────────────────────
        modelBuilder.Entity<SupplierAcceptanceRule>(b =>
        {
            b.ToTable("supplier_acceptance_rules");
            b.HasKey(x => x.Id);
            b.Property(x => x.Id).HasColumnName("id");
            b.Property(x => x.ProfileId).HasColumnName("profile_id");
            b.Property(x => x.Scope).HasColumnName("scope").IsRequired();
            b.Property(x => x.FieldPath).HasColumnName("field_path").IsRequired();
            b.Property(x => x.Operator).HasColumnName("operator").IsRequired();
            b.Property(x => x.ExpectedValue).HasColumnName("expected_value");
            b.Property(x => x.Severity).HasColumnName("severity").IsRequired();
            b.Property(x => x.BlockOnFail).HasColumnName("block_on_fail");
            b.HasIndex(x => x.ProfileId).HasDatabaseName("IX_supplier_acceptance_rules_profile_id");
        });

        // ── order_validation_results ────────────────────────────────────
        modelBuilder.Entity<OrderValidationResult>(b =>
        {
            b.ToTable("order_validation_results");
            b.HasKey(x => x.Id);
            b.Property(x => x.Id).HasColumnName("id");
            b.Property(x => x.OrgId).HasColumnName("org_id");
            b.Property(x => x.OrderId).HasColumnName("order_id");
            b.Property(x => x.ProfileId).HasColumnName("profile_id");
            b.Property(x => x.RuleId).HasColumnName("rule_id");
            b.Property(x => x.LineNumber).HasColumnName("line_number");
            b.Property(x => x.Severity).HasColumnName("severity").IsRequired();
            b.Property(x => x.Status).HasColumnName("status").IsRequired();
            b.Property(x => x.Code).HasColumnName("code").IsRequired();
            b.Property(x => x.Message).HasColumnName("message").IsRequired();
            b.Property(x => x.DetectedAt).HasColumnName("detected_at").HasColumnType("timestamptz");
            b.HasOne(x => x.Organisation).WithMany().HasForeignKey(x => x.OrgId);
            b.HasIndex(x => new { x.OrgId, x.OrderId })
             .HasDatabaseName("IX_order_validation_results_org_id_order_id");
        });
```

- [ ] **Step 4.4 — Build + migration**
```bash
dotnet build ProcuLink.slnx --no-restore 2>&1 | tail -5
dotnet ef migrations add Wave2AcceptanceProfiles \
  --project ProcuLink.Infrastructure --startup-project ProcuLink.Api 2>&1 | tail -5
```
Inspect: `Up()` has 3 `CreateTable` calls + the unique index on profiles.

- [ ] **Step 4.5 — Full suite**
```bash
dotnet test --configuration Release 2>&1 | tail -8
```

- [ ] **Step 4.6 — Commit and push**
```bash
git add ProcuLink.Core/Entities/SupplierAcceptanceProfile.cs \
        ProcuLink.Core/Entities/SupplierAcceptanceRule.cs \
        ProcuLink.Core/Entities/OrderValidationResult.cs \
        ProcuLink.Infrastructure/ProcuLinkDbContext.cs \
        ProcuLink.Infrastructure/Migrations/
git commit -m "feat(acceptance): supplier_acceptance_profiles + rules + order_validation_results schema"
git push origin main
```

---

## Task 5 — SupplierAcceptanceService (CRUD + activate + validate)

**Repo:** `C:\Users\Dmitri.MARKIT\source\repos\ProcuLink`

- [ ] **Step 5.1 — Pull latest**
```bash
cd "C:\Users\Dmitri.MARKIT\source\repos\ProcuLink"
git pull origin main
```

- [ ] **Step 5.2 — Create `ISupplierAcceptanceService.cs`**

Create `ProcuLink.Core/Services/ISupplierAcceptanceService.cs`:
```csharp
using ProcuLink.Core.Entities;

namespace ProcuLink.Core.Services;

public record AcceptanceRuleInput(
    string Scope, string FieldPath, string Operator,
    string? ExpectedValue, string Severity, bool BlockOnFail);

public interface ISupplierAcceptanceService
{
    Task<SupplierAcceptanceProfile?> GetActiveAsync(Guid orgId, Guid supplierId, CancellationToken ct);
    Task<IReadOnlyList<SupplierAcceptanceProfile>> ListVersionsAsync(Guid orgId, Guid supplierId, CancellationToken ct);

    /// <summary>Creates a new draft version (next version number) with the given rules.</summary>
    Task<SupplierAcceptanceProfile> CreateVersionAsync(
        Guid orgId, Guid supplierId, string? protocol, string? outputFormat,
        IReadOnlyList<AcceptanceRuleInput> rules, string? createdBy, CancellationToken ct);

    /// <summary>Activates a version; archives the previously active one. Returns false if not found.</summary>
    Task<bool> ActivateVersionAsync(Guid orgId, Guid supplierId, int versionNo, CancellationToken ct);

    /// <summary>Evaluates the order against the supplier's active profile, persists + returns results.</summary>
    Task<IReadOnlyList<OrderValidationResult>> ValidateOrderAsync(Guid orgId, Guid orderId, CancellationToken ct);
}
```

- [ ] **Step 5.3 — Create `SupplierAcceptanceService.cs`**

Create `ProcuLink.Api/Services/SupplierAcceptanceService.cs`. The validation evaluator supports operators `required`, `equals`, `in`, `min`, `max` against order-level fields (`currency`, `buyerName`) and line-level fields (`supplierItemCode`, `quantity`, `unitPrice`, `buyerItemCode`, `description`).

```csharp
using System.Globalization;
using Microsoft.EntityFrameworkCore;
using ProcuLink.Core.Entities;
using ProcuLink.Core.Services;
using ProcuLink.Infrastructure;

namespace ProcuLink.Api.Services;

public sealed class SupplierAcceptanceService : ISupplierAcceptanceService
{
    private readonly ProcuLinkDbContext _db;
    public SupplierAcceptanceService(ProcuLinkDbContext db) => _db = db;

    public async Task<SupplierAcceptanceProfile?> GetActiveAsync(Guid orgId, Guid supplierId, CancellationToken ct) =>
        await _db.SupplierAcceptanceProfiles
            .Include(p => p.Rules)
            .Where(p => p.OrgId == orgId && p.SupplierId == supplierId && p.Status == "active")
            .FirstOrDefaultAsync(ct);

    public async Task<IReadOnlyList<SupplierAcceptanceProfile>> ListVersionsAsync(Guid orgId, Guid supplierId, CancellationToken ct) =>
        await _db.SupplierAcceptanceProfiles
            .Include(p => p.Rules)
            .Where(p => p.OrgId == orgId && p.SupplierId == supplierId)
            .OrderByDescending(p => p.VersionNo)
            .ToListAsync(ct);

    public async Task<SupplierAcceptanceProfile> CreateVersionAsync(
        Guid orgId, Guid supplierId, string? protocol, string? outputFormat,
        IReadOnlyList<AcceptanceRuleInput> rules, string? createdBy, CancellationToken ct)
    {
        var nextVersion = 1 + await _db.SupplierAcceptanceProfiles
            .Where(p => p.OrgId == orgId && p.SupplierId == supplierId)
            .Select(p => (int?)p.VersionNo)
            .MaxAsync(ct) ?? 1;

        var profile = new SupplierAcceptanceProfile
        {
            Id = Guid.NewGuid(), OrgId = orgId, SupplierId = supplierId,
            VersionNo = nextVersion, Status = "draft",
            Protocol = protocol, OutputFormat = outputFormat,
            CreatedBy = createdBy, CreatedAt = DateTime.UtcNow,
            Rules = rules.Select(r => new SupplierAcceptanceRule
            {
                Id = Guid.NewGuid(), Scope = r.Scope, FieldPath = r.FieldPath,
                Operator = r.Operator, ExpectedValue = r.ExpectedValue,
                Severity = r.Severity, BlockOnFail = r.BlockOnFail,
            }).ToList(),
        };
        _db.SupplierAcceptanceProfiles.Add(profile);
        await _db.SaveChangesAsync(ct);
        return profile;
    }

    public async Task<bool> ActivateVersionAsync(Guid orgId, Guid supplierId, int versionNo, CancellationToken ct)
    {
        var versions = await _db.SupplierAcceptanceProfiles
            .Where(p => p.OrgId == orgId && p.SupplierId == supplierId)
            .ToListAsync(ct);
        var target = versions.FirstOrDefault(p => p.VersionNo == versionNo);
        if (target is null) return false;

        var now = DateTime.UtcNow;
        foreach (var v in versions)
        {
            if (v.Status == "active" && v.Id != target.Id)
            {
                v.Status = "archived";
                v.EffectiveTo = now;
            }
        }
        target.Status = "active";
        target.EffectiveFrom = now;
        target.EffectiveTo = null;
        await _db.SaveChangesAsync(ct);
        return true;
    }

    public async Task<IReadOnlyList<OrderValidationResult>> ValidateOrderAsync(Guid orgId, Guid orderId, CancellationToken ct)
    {
        var order = await _db.PurchaseOrders
            .Include(o => o.Lines)
            .Where(o => o.Id == orderId && o.OrgId == orgId)
            .FirstOrDefaultAsync(ct);
        if (order is null) return Array.Empty<OrderValidationResult>();

        var profile = await GetActiveAsync(orgId, order.SupplierId, ct);
        var now = DateTime.UtcNow;

        // Clear prior results for this order (re-validation overwrites)
        var prior = _db.OrderValidationResults.Where(r => r.OrgId == orgId && r.OrderId == orderId);
        _db.OrderValidationResults.RemoveRange(prior);

        var results = new List<OrderValidationResult>();

        if (profile is not null)
        {
            foreach (var rule in profile.Rules)
            {
                if (rule.Scope == "order")
                {
                    var (pass, val) = EvaluateOrderField(order, rule);
                    results.Add(MakeResult(orgId, orderId, profile.Id, rule, null, pass, val, now));
                }
                else // line scope
                {
                    foreach (var line in order.Lines)
                    {
                        var (pass, val) = EvaluateLineField(line, rule);
                        results.Add(MakeResult(orgId, orderId, profile.Id, rule, line.LineNumber, pass, val, now));
                    }
                }
            }
        }

        _db.OrderValidationResults.AddRange(results);
        await _db.SaveChangesAsync(ct);
        return results;
    }

    // ── evaluation helpers ──────────────────────────────────────────────────

    private static OrderValidationResult MakeResult(
        Guid orgId, Guid orderId, Guid profileId, SupplierAcceptanceRule rule,
        int? lineNumber, bool pass, string? actualValue, DateTime now) => new()
    {
        Id = Guid.NewGuid(), OrgId = orgId, OrderId = orderId,
        ProfileId = profileId, RuleId = rule.Id, LineNumber = lineNumber,
        Severity = rule.Severity, Status = pass ? "pass" : "fail",
        Code = $"{rule.FieldPath}.{rule.Operator}",
        Message = pass
            ? $"{rule.FieldPath} satisfies {rule.Operator}"
            : $"{rule.FieldPath} ('{actualValue}') failed rule {rule.Operator} {rule.ExpectedValue}",
        DetectedAt = now,
    };

    private static (bool pass, string? value) EvaluateOrderField(PurchaseOrderEntity o, SupplierAcceptanceRule rule)
    {
        string? v = rule.FieldPath switch
        {
            "currency"  => o.Currency,
            "buyerName" => o.BuyerName,
            _           => null,
        };
        return (Evaluate(rule, v), v);
    }

    private static (bool pass, string? value) EvaluateLineField(PurchaseOrderLineEntity l, SupplierAcceptanceRule rule)
    {
        string? v = rule.FieldPath switch
        {
            "supplierItemCode" => l.SupplierItemCode,
            "buyerItemCode"    => l.BuyerItemCode,
            "description"      => l.Description,
            "quantity"         => l.Quantity.ToString(CultureInfo.InvariantCulture),
            "unitPrice"        => l.UnitPrice.ToString(CultureInfo.InvariantCulture),
            _                  => null,
        };
        return (Evaluate(rule, v), v);
    }

    private static bool Evaluate(SupplierAcceptanceRule rule, string? actual)
    {
        switch (rule.Operator)
        {
            case "required":
                return !string.IsNullOrWhiteSpace(actual);
            case "equals":
                return string.Equals(actual, rule.ExpectedValue, StringComparison.OrdinalIgnoreCase);
            case "in":
                var allowed = (rule.ExpectedValue ?? "").Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
                return actual is not null && allowed.Contains(actual, StringComparer.OrdinalIgnoreCase);
            case "min":
                return double.TryParse(actual, NumberStyles.Any, CultureInfo.InvariantCulture, out var a1)
                    && double.TryParse(rule.ExpectedValue, NumberStyles.Any, CultureInfo.InvariantCulture, out var m1)
                    && a1 >= m1;
            case "max":
                return double.TryParse(actual, NumberStyles.Any, CultureInfo.InvariantCulture, out var a2)
                    && double.TryParse(rule.ExpectedValue, NumberStyles.Any, CultureInfo.InvariantCulture, out var m2)
                    && a2 <= m2;
            default:
                return true; // unknown operator → non-blocking pass
        }
    }
}
```

- [ ] **Step 5.4 — Register DI**

In `ProcuLink.Api/Program.cs` (and `Worker/Program.cs` only if a job uses it — it does not, so Api only):
```csharp
builder.Services.AddScoped<ISupplierAcceptanceService, SupplierAcceptanceService>();
```

- [ ] **Step 5.5 — Write tests**

Create `ProcuLink.Api.Tests/Services/SupplierAcceptanceServiceTests.cs`:
- `CreateVersion_FirstVersion_IsVersion1Draft`
- `CreateVersion_SecondVersion_IncrementsVersionNo`
- `ActivateVersion_ArchivesPreviousActive`
- `ValidateOrder_RequiredSupplierItemCode_FailsForUnresolvedLine` (seed order with a line missing supplierItemCode + active profile with rule {scope:line, field:supplierItemCode, op:required, severity:error} → assert one fail result persisted)
- `ValidateOrder_NoActiveProfile_ReturnsEmpty`

Seed orders + profiles via in-memory EF (see `OrderExceptionServiceTests` seeding pattern). Construct the service with `new SupplierAcceptanceService(db)`.

- [ ] **Step 5.6 — Run tests + full suite**
```bash
dotnet test ProcuLink.Api.Tests/ProcuLink.Api.Tests.csproj --filter "FullyQualifiedName~SupplierAcceptanceServiceTests" -v minimal 2>&1 | tail -10
dotnet test --configuration Release 2>&1 | tail -8
```

- [ ] **Step 5.7 — Commit and push**
```bash
git add ProcuLink.Core/Services/ISupplierAcceptanceService.cs \
        ProcuLink.Api/Services/SupplierAcceptanceService.cs \
        ProcuLink.Api/Program.cs \
        ProcuLink.Api.Tests/Services/SupplierAcceptanceServiceTests.cs
git commit -m "feat(acceptance): versioned profile CRUD/activate + rule-based order validation engine"
git push origin main
```

---

## Task 6 — Acceptance endpoints + validate + Passport integration

**Repo:** `C:\Users\Dmitri.MARKIT\source\repos\ProcuLink`

- [ ] **Step 6.1 — Pull latest**
```bash
cd "C:\Users\Dmitri.MARKIT\source\repos\ProcuLink"
git pull origin main
```

- [ ] **Step 6.2 — Create DTOs**

Create `ProcuLink.Api/Contracts/AcceptanceProfileDto.cs`:
```csharp
namespace ProcuLink.Api.Contracts;

public record AcceptanceRuleDto(
    Guid?   Id, string Scope, string FieldPath, string Operator,
    string? ExpectedValue, string Severity, bool BlockOnFail);

public record AcceptanceProfileDto(
    Guid    Id, int VersionNo, string Status,
    string? Protocol, string? OutputFormat,
    DateTime? EffectiveFrom, DateTime? EffectiveTo,
    DateTime CreatedAt,
    IReadOnlyList<AcceptanceRuleDto> Rules);

public record CreateAcceptanceProfileRequest(
    string? Protocol, string? OutputFormat,
    IReadOnlyList<AcceptanceRuleDto> Rules);

public record OrderValidationResultDto(
    int?    LineNumber, string Severity, string Status,
    string  Code, string Message);
```

- [ ] **Step 6.3 — Create `SupplierAcceptanceController.cs`**

Create `ProcuLink.Api/Controllers/SupplierAcceptanceController.cs` (route `api/suppliers/{supplierId:guid}/acceptance-profile`):
- `GET ""` → active profile (404 if none)
- `GET "versions"` → all versions
- `POST ""` (body `CreateAcceptanceProfileRequest`) → create draft version, return `AcceptanceProfileDto`
- `POST "{versionNo:int}/activate"` → activate (204 / 404)

`[Authorize]`, inject `ISupplierAcceptanceService` + `ICurrentTenantService`. Map entities → DTOs. Follow the `DeliveriesController`/`ExceptionsController` patterns.

- [ ] **Step 6.4 — Add validate endpoint to `OrdersController.cs`**

Inject `ISupplierAcceptanceService _acceptance` into `OrdersController`. Add:
```csharp
    [HttpPost("{id:guid}/validate")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> Validate(Guid id, CancellationToken ct)
    {
        var results = await _acceptance.ValidateOrderAsync(_tenant.OrganisationId, id, ct);
        return Ok(results.Select(r => new OrderValidationResultDto(
            r.LineNumber, r.Severity, r.Status, r.Code, r.Message)));
    }
```

- [ ] **Step 6.5 — Populate `validationResults` in `PassportService.cs`**

Read `ProcuLink.Api/Services/PassportService.cs`. Line 122 currently:
```csharp
var validationResults = Array.Empty<PassportValidationResult>();
```
Replace with a query of persisted validation results:
```csharp
var validationResults = await _db.OrderValidationResults
    .AsNoTracking()
    .Where(r => r.OrgId == orgId && r.OrderId == orderId)
    .OrderBy(r => r.LineNumber)
    .Select(r => new PassportValidationResult(
        r.LineNumber,
        r.Severity,
        r.Code,
        r.Message))
    .ToListAsync(ct);
```
Confirm `orgId` and `orderId` variable names match what's in scope in that method (read the method signature). If there's a `Notes` entry that says validation results aren't persisted, remove that note when results exist.

- [ ] **Step 6.6 — Write controller tests**

Create `ProcuLink.Api.Tests/Controllers/SupplierAcceptanceControllerTests.cs` with `Mock<ISupplierAcceptanceService>`:
- `GetActive_Returns404_WhenNoProfile`
- `CreateVersion_Returns200_WithDto`
- `Activate_Returns204_WhenServiceReturnsTrue`
- `Activate_Returns404_WhenServiceReturnsFalse`

- [ ] **Step 6.7 — Build + full suite**
```bash
dotnet build ProcuLink.slnx --no-restore 2>&1 | tail -5
dotnet test --configuration Release 2>&1 | tail -8
```

- [ ] **Step 6.8 — Commit and push**
```bash
git add ProcuLink.Api/Contracts/AcceptanceProfileDto.cs \
        ProcuLink.Api/Controllers/SupplierAcceptanceController.cs \
        ProcuLink.Api/Controllers/OrdersController.cs \
        ProcuLink.Api/Services/PassportService.cs \
        ProcuLink.Api.Tests/Controllers/SupplierAcceptanceControllerTests.cs
git commit -m "feat(acceptance): profile CRUD/activate endpoints + POST /orders/{id}/validate + passport validation results"
git push origin main
```

---

## Task 7 — Frontend: Exceptions queue UI

**Repo:** `C:\Users\Dmitri.MARKIT\source\repos\project-proculink`

- [ ] **Step 7.1 — Pull latest**
```bash
cd "C:\Users\Dmitri.MARKIT\source\repos\project-proculink"
git pull origin main
```

- [ ] **Step 7.2 — Add types to `src/types/procurement.ts`**
```typescript
export interface OrderExceptionDto {
  id: string;
  orderId: string;
  lineId: string | null;
  stage: string;
  code: string;
  severity: "info" | "warning" | "error" | "critical";
  state: "open" | "resolved" | "ignored";
  message: string;
  createdAt: string;
  resolvedAt: string | null;
}
```

- [ ] **Step 7.3 — Add api-client functions to `src/lib/api-client.ts`**

Add real + mock pairs and wire into `apiClient`:
```typescript
async function realGetExceptions(state?: string): Promise<OrderExceptionDto[]> {
  const qs = state ? `?state=${encodeURIComponent(state)}` : "";
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/exceptions${qs}`, { headers: await authHeader() });
  if (!res.ok) throw new Error(`exceptions: ${res.statusText}`);
  return res.json() as Promise<OrderExceptionDto[]>;
}
async function mockGetExceptions(): Promise<OrderExceptionDto[]> { await delay(150); return []; }

async function realResolveException(id: string): Promise<void> {
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/exceptions/${id}/resolve`,
    { method: "PATCH", headers: await authHeader() }, 30000);
  if (!res.ok) throw new Error(`exceptions/resolve: ${res.statusText}`);
}
async function mockResolveException(_id: string): Promise<void> { await delay(150); }

async function realIgnoreException(id: string): Promise<void> {
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/exceptions/${id}/ignore`,
    { method: "PATCH", headers: await authHeader() }, 30000);
  if (!res.ok) throw new Error(`exceptions/ignore: ${res.statusText}`);
}
async function mockIgnoreException(_id: string): Promise<void> { await delay(150); }
```
Add to the `apiClient` export:
```typescript
  getExceptions:     USE_MOCK ? mockGetExceptions     : realGetExceptions,
  resolveException:  USE_MOCK ? mockResolveException  : realResolveException,
  ignoreException:   USE_MOCK ? mockIgnoreException   : realIgnoreException,
```
Import `OrderExceptionDto` in the type import block.

- [ ] **Step 7.4 — Create `ExceptionsView.tsx`**

Create `src/components/bridge/ExceptionsView.tsx` — a `"use client"` component:
- `useQuery(["exceptions", stateFilter], () => apiClient.getExceptions(stateFilter))`
- Severity filter chips (all / open) and a table/cards list (follow the responsive desktop-table + mobile-cards pattern used in `InboxView.tsx` / `CrossingsLog.tsx`)
- Each row: severity dot, stage, code (humanised), message, PO link (`/inbox/{orderId}`), created time, and **Resolve** / **Ignore** buttons
- `useMutation` for resolve/ignore that invalidates `["exceptions"]` and `["orders-summary"]`
- Honest empty state: "No open exceptions. Everything is flowing." when the list is empty
- Use the Bridge token palette (severity colors: critical `#C53A3A`, error `#C53A3A`, warning `#C97A14`, info `#1E66C9`)

Read `InboxView.tsx` for the exact responsive table/card pattern and styling tokens before writing.

- [ ] **Step 7.5 — Create the route page**

Create `src/app/(app)/operations/exceptions/page.tsx`:
```tsx
import { ExceptionsView } from "@/components/bridge/ExceptionsView";

export default function ExceptionsPage() {
  return <ExceptionsView />;
}
```

- [ ] **Step 7.6 — Add nav + dashboard link**

In `src/components/bridge/BridgeSidebar.tsx`, add an "Exceptions" item to the Operations group:
```typescript
{ label: "Exceptions", href: "/operations/exceptions", icon: AlertTriangle },
```
(Import `AlertTriangle` from lucide-react if not already imported.)

In `src/components/bridge/BridgeDashboard.tsx`, make the "Urgent exceptions" KPI card link to `/operations/exceptions` (wrap the card content in a `Link` or add a "View exceptions →" link in its sub-text).

- [ ] **Step 7.7 — Build**
```bash
bun run build 2>&1 | tail -5
```
Expected: 0 TypeScript errors.

- [ ] **Step 7.8 — Commit and push**
```bash
git add src/types/procurement.ts src/lib/api-client.ts \
        src/components/bridge/ExceptionsView.tsx \
        src/app/(app)/operations/exceptions/page.tsx \
        src/components/bridge/BridgeSidebar.tsx \
        src/components/bridge/BridgeDashboard.tsx
git commit -m "feat(exceptions): /operations/exceptions queue UI + sidebar nav + dashboard link"
git push origin main
```

---

## Task 8 — Frontend: Acceptance Profile tab + validation results

**Repo:** `C:\Users\Dmitri.MARKIT\source\repos\project-proculink`

- [ ] **Step 8.1 — Pull latest**
```bash
cd "C:\Users\Dmitri.MARKIT\source\repos\project-proculink"
git pull origin main
```

- [ ] **Step 8.2 — Add types to `src/types/procurement.ts`**
```typescript
export interface AcceptanceRule {
  id?: string;
  scope: "order" | "line";
  fieldPath: string;
  operator: "required" | "equals" | "in" | "min" | "max";
  expectedValue: string | null;
  severity: "warning" | "error";
  blockOnFail: boolean;
}
export interface AcceptanceProfile {
  id: string;
  versionNo: number;
  status: "draft" | "active" | "archived";
  protocol: string | null;
  outputFormat: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  createdAt: string;
  rules: AcceptanceRule[];
}
export interface OrderValidationResultDto {
  lineNumber: number | null;
  severity: "info" | "warning" | "error";
  status: "pass" | "fail";
  code: string;
  message: string;
}
```

- [ ] **Step 8.3 — Add api-client functions**

Add real + mock pairs + wire into `apiClient`:
```typescript
async function realGetAcceptanceProfile(supplierId: string): Promise<AcceptanceProfile | null> {
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/suppliers/${supplierId}/acceptance-profile`, { headers: await authHeader() });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`acceptance-profile: ${res.statusText}`);
  return res.json() as Promise<AcceptanceProfile>;
}
async function mockGetAcceptanceProfile(_s: string): Promise<AcceptanceProfile | null> { await delay(150); return null; }

async function realSaveAcceptanceProfile(supplierId: string, body: { protocol: string | null; outputFormat: string | null; rules: import("@/types/procurement").AcceptanceRule[] }): Promise<AcceptanceProfile> {
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/suppliers/${supplierId}/acceptance-profile`,
    { method: "POST", headers: { "Content-Type": "application/json", ...await authHeader() }, body: JSON.stringify(body) }, 30000);
  if (!res.ok) throw new Error(`acceptance-profile/save: ${res.statusText}`);
  return res.json() as Promise<AcceptanceProfile>;
}
async function mockSaveAcceptanceProfile(_s: string, _b: unknown): Promise<AcceptanceProfile> { await delay(150); throw new Error("Mock mode"); }

async function realActivateAcceptanceVersion(supplierId: string, versionNo: number): Promise<void> {
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/suppliers/${supplierId}/acceptance-profile/${versionNo}/activate`,
    { method: "POST", headers: await authHeader() }, 30000);
  if (!res.ok) throw new Error(`acceptance-profile/activate: ${res.statusText}`);
}
async function mockActivateAcceptanceVersion(_s: string, _v: number): Promise<void> { await delay(150); }

async function realValidateOrder(orderId: string): Promise<OrderValidationResultDto[]> {
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/orders/${orderId}/validate`,
    { method: "POST", headers: await authHeader() }, 30000);
  if (!res.ok) throw new Error(`orders/validate: ${res.statusText}`);
  return res.json() as Promise<OrderValidationResultDto[]>;
}
async function mockValidateOrder(_o: string): Promise<OrderValidationResultDto[]> { await delay(150); return []; }
```
Wire all five into `apiClient`. Import the new types.

- [ ] **Step 8.4 — Add Acceptance tab to `SupplierDockProfile.tsx`**

Read `src/components/bridge/SupplierDockProfile.tsx`. The `Tab` type is `"overview" | "mappings" | "po-mapping" | "delivery"`. Add `"acceptance"`:
```typescript
type Tab = "overview" | "mappings" | "po-mapping" | "delivery" | "acceptance";
```
Add `{ id: "acceptance", label: "Acceptance" }` to the `TABS` array.

Add a tab body block `{tab === "acceptance" && (...)}` rendering:
- `useQuery(["acceptance-profile", supplierId], () => apiClient.getAcceptanceProfile(supplierId))`
- If a profile exists: show version + status badge + a read/edit table of rules (scope, fieldPath, operator, expectedValue, severity)
- A rule editor (add/remove rows) and **Save new version** button (`useMutation` → `saveAcceptanceProfile`), and **Activate** for draft versions
- Honest empty state when null: "No acceptance profile yet. Define what this supplier will accept."

Keep it consistent with the existing tab styling. The supplierId comes from the component's existing props/route param — check how `mappings`/`delivery` tabs get it.

- [ ] **Step 8.5 — Add validation results panel to `SpineReview.tsx`**

Read `src/components/bridge/SpineReview.tsx`. Add a "Validation" panel (near the issues rail) that:
- has a **Validate against supplier profile** button → `useMutation(() => apiClient.validateOrder(orderId))`
- renders the returned results: group by pass/fail, show fail results with severity color + message + line number
- empty/initial state: "Run validation to check this order against the supplier's acceptance rules."

Keep scope tight — a single panel, not a redesign. Read the file's existing rail/panel structure first.

- [ ] **Step 8.6 — Build**
```bash
bun run build 2>&1 | tail -5
```
Expected: 0 TypeScript errors.

- [ ] **Step 8.7 — Commit and push**
```bash
git add src/types/procurement.ts src/lib/api-client.ts \
        src/components/bridge/SupplierDockProfile.tsx \
        src/components/bridge/SpineReview.tsx
git commit -m "feat(acceptance): supplier Acceptance tab (versioned rule editor) + order validation panel"
git push origin main
```

---

## Self-Review

**Spec coverage:**

| Audit requirement | Task |
|---|---|
| `order_exceptions` table | T1 |
| Auto-generation from failures (idempotent) | T2 |
| `/api/exceptions` list/resolve/ignore | T3 |
| `/operations/exceptions` page | T7 |
| `supplier_acceptance_profiles` (versioned) | T4 |
| `supplier_acceptance_rules` (typed) | T4 |
| `order_validation_results` | T4 |
| Profile CRUD + activate + validate | T5, T6 |
| Acceptance tab in supplier UI | T8 |
| Validation results in passport + review | T6, T8 |

**Lean v1 boundaries honored:** no assignee, no SLA deadline, no exception state beyond open/resolved/ignored. Acceptance validation is on-demand (POST /validate), not auto-run during parse — auto-validate is a documented follow-up.

**Collision avoidance:** every task pulls then pushes; two migrations (T1, T4) are separated by committed/pushed tasks so no competing migration is generated concurrently.

**Project-reference risk (T2):** flagged explicitly — if `DeliveryService` (Infrastructure) cannot reference `OrderExceptionService` (Api), the service moves to Infrastructure. The implementer decides based on actual project references and reports the choice. `IOrderExceptionService` lives in Core either way, so controllers/services depend only on the interface.

**Type consistency:** `OrderExceptionDto` (backend record) ↔ `OrderExceptionDto` (TS interface) field names match camelCase serialization. `AcceptanceRule`/`AcceptanceProfile` TS shapes mirror `AcceptanceRuleDto`/`AcceptanceProfileDto`. `OrderValidationResultDto` matches `PassportValidationResult` field semantics (LineNumber/Severity/Code/Message).

**Placeholder scan:** Frontend UI tasks (T7 ExceptionsView, T8 tab/panel) intentionally instruct the implementer to read the existing responsive patterns (`InboxView`, `SupplierDockProfile`, `SpineReview`) rather than embedding 300 lines of speculative JSX — the data contracts, queries, mutations, and states are fully specified; the visual layout follows established components.
