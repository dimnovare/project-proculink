# Aggregate View Accuracy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make sidebar badge, notifications count, dashboard KPIs, dashboard topology, and command palette search accurate for orgs with more than 100 orders.

**Architecture:** Two new backend endpoints (`GET /api/orders/summary` for per-status counts; `GET /api/dashboard/topology` for wire topology over all orders) plus frontend changes that consume them. Sidebar/notifications use summary for counts. Dashboard topology prefers the real endpoint over the 100-order client derivation. Dashboard windowed KPIs use `pageSize:1` count queries for accuracy. Command palette uses server-side debounced search.

**Tech Stack:** ASP.NET Core 8 (C#) in `ProcuLink` repo; Next.js 15 / TypeScript / TanStack Query in `project-proculink` repo. Both repos have separate git remotes and must be committed independently.

---

## File Map

### Backend (`C:\Users\Dmitri.MARKIT\source\repos\ProcuLink`)

| Action | File |
|---|---|
| Create | `ProcuLink.Api/Contracts/OrdersSummaryDto.cs` |
| Create | `ProcuLink.Api/Contracts/DashboardTopologyDto.cs` |
| Modify | `ProcuLink.Api/Controllers/DashboardController.cs` (add 2 endpoints) |
| Create | `ProcuLink.Api.Tests/Controllers/DashboardControllerTests.cs` |

### Frontend (`C:\Users\Dmitri.MARKIT\source\repos\project-proculink`)

| Action | File |
|---|---|
| Modify | `src/types/procurement.ts` (add `OrdersSummary`) |
| Modify | `src/lib/api-client.ts` (add `getOrdersSummary`, `mockGetDashboardTopology` returns real data; add `mockGetOrdersSummary`) |
| Modify | `src/components/bridge/BridgeSidebar.tsx` (swap to summary query) |
| Modify | `src/components/bridge/BridgeTopbar.tsx` (unread count from summary) |
| Modify | `src/components/bridge/BridgeDashboard.tsx` (topology priority flip; windowed KPIs; exceptions from summary) |
| Modify | `src/components/bridge/CommandPalette.tsx` (debounced server search) |

---

## Task 1 — Backend: `OrdersSummaryDto` and `DashboardTopologyDto` contracts

**Repo:** `C:\Users\Dmitri.MARKIT\source\repos\ProcuLink`

**Files:**
- Create: `ProcuLink.Api/Contracts/OrdersSummaryDto.cs`
- Create: `ProcuLink.Api/Contracts/DashboardTopologyDto.cs`

- [ ] **Step 1.1 — Create `OrdersSummaryDto.cs`**

```csharp
// ProcuLink.Api/Contracts/OrdersSummaryDto.cs
namespace ProcuLink.Api.Contracts;

/// <summary>
/// Per-status order counts for the authenticated org.
/// Keys are order status strings (e.g. "pending_review", "delivered").
/// </summary>
public record OrdersSummaryDto(
    Dictionary<string, int> ByStatus,
    int                     Total
);
```

- [ ] **Step 1.2 — Create `DashboardTopologyDto.cs`**

```csharp
// ProcuLink.Api/Contracts/DashboardTopologyDto.cs
namespace ProcuLink.Api.Contracts;

public record TopologyBuyerDto(string Id, string Name, string Code, string Volume);

public record TopologySupplierDto(string Id, string Name, string Code, string Volume, int Health);

public record TopologyWireDto(
    string   BuyerId,
    string   SupplierId,
    int      Weight,
    string   Health,   // "ok" | "risk" | "down"
    int?     Alert
);

public record DashboardTopologyDto(
    IReadOnlyList<TopologyBuyerDto>    Buyers,
    IReadOnlyList<TopologySupplierDto> Suppliers,
    IReadOnlyList<TopologyWireDto>     Wires
);
```

- [ ] **Step 1.3 — Verify build**

```bash
cd "C:\Users\Dmitri.MARKIT\source\repos\ProcuLink"
dotnet build ProcuLink.Api/ProcuLink.Api.csproj -c Release --no-restore 2>&1 | tail -5
```

Expected: `Build succeeded. 0 Error(s)`

- [ ] **Step 1.4 — Commit**

```bash
cd "C:\Users\Dmitri.MARKIT\source\repos\ProcuLink"
git add ProcuLink.Api/Contracts/OrdersSummaryDto.cs ProcuLink.Api/Contracts/DashboardTopologyDto.cs
git commit -m "feat(api): add OrdersSummaryDto and DashboardTopologyDto contracts"
```

---

## Task 2 — Backend: `GET /api/orders/summary` + tests

**Repo:** `C:\Users\Dmitri.MARKIT\source\repos\ProcuLink`

**Files:**
- Modify: `ProcuLink.Api/Controllers/DashboardController.cs`
- Create: `ProcuLink.Api.Tests/Controllers/DashboardControllerTests.cs`

- [ ] **Step 2.1 — Write failing test for `/api/orders/summary`**

Create `ProcuLink.Api.Tests/Controllers/DashboardControllerTests.cs`:

```csharp
using FluentAssertions;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using ProcuLink.Api.Contracts;
using ProcuLink.Api.Controllers;
using ProcuLink.Core.Entities;
using ProcuLink.Core.Services;
using ProcuLink.Infrastructure;
using Xunit;

namespace ProcuLink.Api.Tests.Controllers;

public class DashboardControllerTests
{
    private static ProcuLinkDbContext MakeDb() =>
        new(new DbContextOptionsBuilder<ProcuLinkDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options);

    private static (DashboardController Ctrl, Guid OrgId, ProcuLinkDbContext Db)
        Build(ProcuLinkDbContext? db = null)
    {
        db ??= MakeDb();
        var orgId  = Guid.NewGuid();
        var tenant = new Mock<ICurrentTenantService>();
        tenant.SetupGet(t => t.OrganisationId).Returns(orgId);
        return (new DashboardController(db, tenant.Object), orgId, db);
    }

    // ── GET /api/orders/summary ───────────────────────────────────────────────

    [Fact]
    public async Task GetSummary_ReturnsByStatusCountsForOrg()
    {
        var (ctrl, orgId, db) = Build();
        var supplierId = Guid.NewGuid();

        db.PurchaseOrders.AddRange(
            MakeOrder(orgId, supplierId, "pending_review"),
            MakeOrder(orgId, supplierId, "pending_review"),
            MakeOrder(orgId, supplierId, "delivered"),
            MakeOrder(Guid.NewGuid(), supplierId, "pending_review") // different org — must not appear
        );
        await db.SaveChangesAsync();

        var result = await ctrl.GetSummary(CancellationToken.None);
        var ok     = result.Should().BeOfType<OkObjectResult>().Subject;
        var dto    = ok.Value.Should().BeOfType<OrdersSummaryDto>().Subject;

        dto.Total.Should().Be(3);
        dto.ByStatus["pending_review"].Should().Be(2);
        dto.ByStatus["delivered"].Should().Be(1);
        dto.ByStatus.Should().NotContainKey("delivery_failed"); // absent statuses omitted
    }

    [Fact]
    public async Task GetSummary_EmptyOrg_ReturnsZeroTotal()
    {
        var (ctrl, _, _) = Build();
        var result = await ctrl.GetSummary(CancellationToken.None);
        var ok     = result.Should().BeOfType<OkObjectResult>().Subject;
        var dto    = ok.Value.Should().BeOfType<OrdersSummaryDto>().Subject;
        dto.Total.Should().Be(0);
        dto.ByStatus.Should().BeEmpty();
    }

    // ── GET /api/dashboard/topology ──────────────────────────────────────────

    [Fact]
    public async Task GetTopology_ReturnsAggregatedBuyersAndSuppliers()
    {
        var (ctrl, orgId, db) = Build();
        var supplierId = Guid.NewGuid();
        db.Suppliers.Add(new SupplierEntity
        {
            Id = supplierId, OrgId = orgId, Name = "Acme Supplies",
            IsDeleted = false, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
        });
        db.PurchaseOrders.AddRange(
            MakeOrderWithBuyer(orgId, supplierId, "delivered",       "Buyer Corp"),
            MakeOrderWithBuyer(orgId, supplierId, "delivered",       "Buyer Corp"),
            MakeOrderWithBuyer(orgId, supplierId, "delivery_failed", "Buyer Corp")
        );
        await db.SaveChangesAsync();

        var result = await ctrl.GetTopology(CancellationToken.None);
        var ok     = result.Should().BeOfType<OkObjectResult>().Subject;
        var dto    = ok.Value.Should().BeOfType<DashboardTopologyDto>().Subject;

        dto.Buyers.Should().HaveCount(1);
        dto.Buyers[0].Name.Should().Be("Buyer Corp");

        dto.Suppliers.Should().HaveCount(1);
        dto.Suppliers[0].Name.Should().Be("Acme Supplies");
        dto.Suppliers[0].Health.Should().Be(67); // 2/3 not-failed = 66.6 → round = 67

        dto.Wires.Should().HaveCount(1);
        dto.Wires[0].Health.Should().Be("down"); // has failed orders
        dto.Wires[0].Alert.Should().Be(1); // 1 delivery_failed (exception)
    }

    [Fact]
    public async Task GetTopology_CrossOrg_Excluded()
    {
        var (ctrl, orgId, db) = Build();
        var supplierId = Guid.NewGuid();
        db.Suppliers.Add(new SupplierEntity
        {
            Id = supplierId, OrgId = orgId, Name = "My Supplier",
            IsDeleted = false, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
        });
        // Order from a different org that happens to reference same supplier id
        db.PurchaseOrders.Add(
            MakeOrderWithBuyer(Guid.NewGuid(), supplierId, "delivered", "Other Buyer"));
        await db.SaveChangesAsync();

        var result = await ctrl.GetTopology(CancellationToken.None);
        var ok     = result.Should().BeOfType<OkObjectResult>().Subject;
        var dto    = ok.Value.Should().BeOfType<DashboardTopologyDto>().Subject;

        dto.Buyers.Should().BeEmpty();
        dto.Wires.Should().BeEmpty();
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    private static PurchaseOrderEntity MakeOrder(Guid orgId, Guid supplierId, string status) =>
        new()
        {
            Id = Guid.NewGuid(), OrgId = orgId, SupplierId = supplierId,
            PoNumber = $"PO-{Guid.NewGuid():N}", Status = status,
            OrderDate = DateOnly.FromDateTime(DateTime.UtcNow),
            Currency = "EUR", CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
        };

    private static PurchaseOrderEntity MakeOrderWithBuyer(
        Guid orgId, Guid supplierId, string status, string buyerName)
    {
        var o = MakeOrder(orgId, supplierId, status);
        o.CanonicalJson = System.Text.Json.JsonDocument.Parse(
            $"{{\"buyerName\":\"{buyerName}\"}}");
        return o;
    }
}
```

- [ ] **Step 2.2 — Run tests to verify they fail**

```bash
cd "C:\Users\Dmitri.MARKIT\source\repos\ProcuLink"
dotnet test ProcuLink.Api.Tests/ProcuLink.Api.Tests.csproj --filter "FullyQualifiedName~DashboardControllerTests" -v minimal 2>&1 | tail -15
```

Expected: compile error or `FAILED` — `GetSummary` and `GetTopology` methods not yet defined.

- [ ] **Step 2.3 — Implement both endpoints in `DashboardController.cs`**

Replace the entire file:

```csharp
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ProcuLink.Api.Contracts;
using ProcuLink.Core.Constants;
using ProcuLink.Core.Services;
using ProcuLink.Infrastructure;

namespace ProcuLink.Api.Controllers;

[Authorize]
[ApiController]
[Route("api/dashboard")]
public class DashboardController : ControllerBase
{
    private readonly ProcuLinkDbContext    _db;
    private readonly ICurrentTenantService _tenant;

    public DashboardController(ProcuLinkDbContext db, ICurrentTenantService tenant)
    {
        _db     = db;
        _tenant = tenant;
    }

    // ── GET /api/dashboard/stats ──────────────────────────────────────────────

    [HttpGet("stats")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> GetStats(CancellationToken ct)
    {
        var orgId     = _tenant.OrganisationId;
        var monthStart = new DateTime(DateTime.UtcNow.Year, DateTime.UtcNow.Month, 1, 0, 0, 0, DateTimeKind.Utc);

        var totalThisMonth = await _db.PurchaseOrders
            .CountAsync(o => o.OrgId == orgId && o.CreatedAt >= monthStart, ct);

        var pendingReview = await _db.PurchaseOrders
            .CountAsync(o => o.OrgId == orgId && o.Status == OrderStatusConstants.PendingReview, ct);

        var delivered = await _db.PurchaseOrders
            .CountAsync(o => o.OrgId == orgId && o.Status == OrderStatusConstants.Delivered, ct);

        var totalOrders = await _db.PurchaseOrders
            .CountAsync(o => o.OrgId == orgId, ct);

        return Ok(new { totalOrdersThisMonth = totalThisMonth, pendingReview, delivered, totalOrders });
    }

    // ── GET /api/orders/summary ───────────────────────────────────────────────
    // Per-status order counts — used by sidebar badge, notifications bell,
    // and dashboard "urgent exceptions" KPI. SQL GROUP BY, no line data loaded.

    [HttpGet("/api/orders/summary")]
    [ProducesResponseType(typeof(OrdersSummaryDto), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetSummary(CancellationToken ct)
    {
        var orgId = _tenant.OrganisationId;

        var rows = await _db.PurchaseOrders
            .AsNoTracking()
            .Where(o => o.OrgId == orgId)
            .GroupBy(o => o.Status)
            .Select(g => new { Status = g.Key, Count = g.Count() })
            .ToListAsync(ct);

        var byStatus = rows.ToDictionary(r => r.Status, r => r.Count);
        var total    = rows.Sum(r => r.Count);

        return Ok(new OrdersSummaryDto(byStatus, total));
    }

    // ── GET /api/dashboard/topology ──────────────────────────────────────────
    // Buyer → supplier wire topology derived from all org orders.
    // Buyer name lives in canonical_json (jsonb) — loaded in-memory per the
    // same pattern used by OrderService.ListPagedAsync.

    private static readonly HashSet<string> FailedStatuses = new(StringComparer.Ordinal)
    {
        OrderStatusConstants.Failed, OrderStatusConstants.DeliveryFailed,
        "transform_failed", OrderStatusConstants.DeliveryDeadLetter,
    };

    private static readonly HashSet<string> ExceptionStatuses = new(StringComparer.Ordinal)
    {
        OrderStatusConstants.PendingReview, OrderStatusConstants.Failed,
        OrderStatusConstants.DeliveryFailed, "transform_failed",
        OrderStatusConstants.DeliveryDeadLetter,
    };

    [HttpGet("topology")]
    [ProducesResponseType(typeof(DashboardTopologyDto), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetTopology(CancellationToken ct)
    {
        var orgId = _tenant.OrganisationId;

        var rows = await _db.PurchaseOrders
            .AsNoTracking()
            .Where(o => o.OrgId == orgId)
            .Select(o => new
            {
                o.Id,
                o.SupplierId,
                SupplierName = o.Supplier != null ? o.Supplier.Name : "Unknown",
                o.Status,
                o.CanonicalJson,
            })
            .ToListAsync(ct);

        // Accumulator keyed by normalised supplier name
        var supMap  = new Dictionary<string, (string Id, string Name, int Total, int Failed, int Exceptions)>(StringComparer.OrdinalIgnoreCase);
        var buyMap  = new Dictionary<string, (string Id, string Name, int Total)>(StringComparer.OrdinalIgnoreCase);
        var wireMap = new Dictionary<string, (string BuyerKey, string SupplierKey, int Total, int Failed, int Exceptions)>(StringComparer.OrdinalIgnoreCase);

        foreach (var row in rows)
        {
            var isFailed    = FailedStatuses.Contains(row.Status);
            var isException = ExceptionStatuses.Contains(row.Status);

            // Supplier accumulation
            var sk = row.SupplierName.Trim().ToLowerInvariant();
            if (!supMap.TryGetValue(sk, out var sa))
                sa = (row.SupplierId.ToString(), row.SupplierName.Trim(), 0, 0, 0);
            supMap[sk] = sa with
            {
                Total      = sa.Total + 1,
                Failed     = sa.Failed + (isFailed ? 1 : 0),
                Exceptions = sa.Exceptions + (isException ? 1 : 0),
            };

            // Buyer name from canonical_json
            string? buyerName = null;
            if (row.CanonicalJson is not null)
            {
                try
                {
                    var root = row.CanonicalJson.RootElement;
                    if (root.TryGetProperty("buyerName", out var el))
                        buyerName = el.GetString();
                    else if (root.TryGetProperty("BuyerName", out var el2))
                        buyerName = el2.GetString();
                }
                catch { /* malformed json */ }
            }
            if (string.IsNullOrWhiteSpace(buyerName)) continue;

            var bk = buyerName.Trim().ToLowerInvariant();
            if (!buyMap.TryGetValue(bk, out var ba))
                ba = ($"buy-{bk}", buyerName.Trim(), 0);
            buyMap[bk] = ba with { Total = ba.Total + 1 };

            // Wire accumulation
            var wk = $"{bk}|||{sk}";
            if (!wireMap.TryGetValue(wk, out var wa))
                wa = (bk, sk, 0, 0, 0);
            wireMap[wk] = wa with
            {
                Total      = wa.Total + 1,
                Failed     = wa.Failed + (isFailed ? 1 : 0),
                Exceptions = wa.Exceptions + (isException ? 1 : 0),
            };
        }

        var buyers = buyMap.Values
            .OrderByDescending(b => b.Total)
            .Select(b => new TopologyBuyerDto(b.Id, b.Name, CodeFor(b.Name), $"{b.Total} ord"))
            .ToList();

        var suppliers = supMap.Values
            .OrderByDescending(s => s.Total)
            .Select(s => new TopologySupplierDto(
                s.Id, s.Name, CodeFor(s.Name), $"{s.Total} ord",
                s.Total == 0 ? 100 : (int)Math.Round(100.0 * (s.Total - s.Failed) / s.Total)))
            .ToList();

        var buyerIdByKey    = buyMap.ToDictionary(kv => kv.Key, kv => kv.Value.Id);
        var supplierIdByKey = supMap.ToDictionary(kv => kv.Key, kv => kv.Value.Id);

        var wires = wireMap.Values
            .Select(w =>
            {
                if (!buyerIdByKey.TryGetValue(w.BuyerKey, out var buyerId)) return null;
                if (!supplierIdByKey.TryGetValue(w.SupplierKey, out var supplierId)) return null;
                var health = w.Failed > 0 ? "down" : w.Exceptions > 0 ? "risk" : "ok";
                return new TopologyWireDto(
                    buyerId, supplierId, WeightFor(w.Total), health,
                    w.Exceptions > 0 ? w.Exceptions : null);
            })
            .Where(w => w is not null)
            .ToList();

        return Ok(new DashboardTopologyDto(buyers, suppliers, wires!));
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    private static string CodeFor(string name)
    {
        var words = System.Text.RegularExpressions.Regex
            .Replace(name, @"[^A-Za-z0-9 ]", " ")
            .Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (words.Length == 0) return "—";
        var initials = string.Concat(words.Select(w => w[0])).ToUpper();
        var code     = initials.Length >= 3 ? initials : string.Concat(words).ToUpper();
        return code[..Math.Min(3, code.Length)];
    }

    private static int WeightFor(int count) => count switch
    {
        <= 1  => 1,
        <= 2  => 2,
        <= 4  => 3,
        <= 8  => 4,
        <= 16 => 5,
        _     => 6,
    };
}
```

- [ ] **Step 2.4 — Run the new tests**

```bash
cd "C:\Users\Dmitri.MARKIT\source\repos\ProcuLink"
dotnet test ProcuLink.Api.Tests/ProcuLink.Api.Tests.csproj --filter "FullyQualifiedName~DashboardControllerTests" -v minimal 2>&1 | tail -20
```

Expected: all 4 tests `PASS`.

- [ ] **Step 2.5 — Run full test suite**

```bash
cd "C:\Users\Dmitri.MARKIT\source\repos\ProcuLink"
dotnet test --configuration Release 2>&1 | tail -10
```

Expected: same pass count as before + 4 new passing tests. No regressions.

- [ ] **Step 2.6 — Commit**

```bash
cd "C:\Users\Dmitri.MARKIT\source\repos\ProcuLink"
git add ProcuLink.Api/Controllers/DashboardController.cs \
        ProcuLink.Api.Tests/Controllers/DashboardControllerTests.cs
git commit -m "feat(api): add /api/orders/summary and /api/dashboard/topology endpoints"
```

---

## Task 3 — Frontend: `OrdersSummary` type + `getOrdersSummary` in api-client

**Repo:** `C:\Users\Dmitri.MARKIT\source\repos\project-proculink`

**Files:**
- Modify: `src/types/procurement.ts`
- Modify: `src/lib/api-client.ts`

- [ ] **Step 3.1 — Add `OrdersSummary` type to `src/types/procurement.ts`**

After the `GetOrdersParams` interface (around line 282), add:

```typescript
export interface OrdersSummary {
  byStatus: Partial<Record<string, number>>;
  total: number;
}
```

- [ ] **Step 3.2 — Add `OrdersSummary` to the import list at the top of `src/lib/api-client.ts`**

Find the import block at lines 1-23 and add `OrdersSummary` to the import:

```typescript
import type {
  Order,
  OrderSummary,
  OrdersPage,
  OrdersSummary,
  GetOrdersParams,
  // ... rest unchanged
```

- [ ] **Step 3.3 — Add mock and real `getOrdersSummary` functions in `src/lib/api-client.ts`**

After the `mockGetOrders` function (around line 390), add:

```typescript
async function mockGetOrdersSummary(): Promise<OrdersSummary> {
  await delay(100);
  const byStatus: Partial<Record<string, number>> = {};
  for (const o of mockOrders) {
    byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
  }
  return { byStatus, total: mockOrders.length };
}

async function realGetOrdersSummary(): Promise<OrdersSummary> {
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/orders/summary`, { headers: await authHeader() });
  if (!res.ok) throw new Error(`orders/summary: ${res.status}`);
  return res.json() as Promise<OrdersSummary>;
}
```

- [ ] **Step 3.4 — Wire into `apiClient` export**

In the `export const apiClient` object (around line 1203), add after `getOrders`:

```typescript
getOrdersSummary:       USE_MOCK ? mockGetOrdersSummary    : realGetOrdersSummary,
```

- [ ] **Step 3.5 — Update `mockGetDashboardTopology` to return real aggregated data**

Replace the existing `realGetDashboardTopology` stub (around line 989) so it calls the actual endpoint:

```typescript
async function realGetDashboardTopology(): Promise<DashboardTopology> {
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/dashboard/topology`, { headers: await authHeader() });
  if (!res.ok) throw new Error(`dashboard/topology: ${res.status}`);
  return res.json() as Promise<DashboardTopology>;
}
```

- [ ] **Step 3.6 — Build check**

```bash
cd "C:\Users\Dmitri.MARKIT\source\repos\project-proculink"
bun run build 2>&1 | tail -10
```

Expected: `✓ Compiled successfully` with 0 type errors.

- [ ] **Step 3.7 — Commit**

```bash
cd "C:\Users\Dmitri.MARKIT\source\repos\project-proculink"
git add src/types/procurement.ts src/lib/api-client.ts
git commit -m "feat(api-client): add getOrdersSummary + wire real getDashboardTopology"
```

---

## Task 4 — Frontend: Sidebar badge from `orders-summary`

**Repo:** `C:\Users\Dmitri.MARKIT\source\repos\project-proculink`

**Files:**
- Modify: `src/components/bridge/BridgeSidebar.tsx`

Currently the sidebar calls `getOrders({ pageSize: 100 })` and counts items locally. It should use `getOrdersSummary()` so the badge is accurate regardless of total order count.

- [ ] **Step 4.1 — Replace the badge query in `BridgeSidebar.tsx`**

Find the query at lines 80-89:
```typescript
const { data: ordersPage } = useQuery({
  queryKey: ["orders"],
  queryFn: () => apiClient.getOrders({ pageSize: 100 }),
  enabled: !isApiMockMode,
  staleTime: 30_000,
});
const orders: OrderSummary[] = ordersPage?.items ?? [];
const reviewCount = orders.filter(
  (o) => o.status === "pending_review" || (o.unresolvedCount ?? 0) > 0,
).length;
```

Replace with:
```typescript
const { data: ordersSummary } = useQuery({
  queryKey: ["orders-summary"],
  queryFn: () => apiClient.getOrdersSummary(),
  staleTime: 30_000,
});
const reviewCount = ordersSummary?.byStatus?.["pending_review"] ?? 0;
```

Also remove the unused `OrderSummary` import from the top of the file:
```typescript
// Remove: import type { OrderSummary } from "@/types/procurement";
```

- [ ] **Step 4.2 — Build check**

```bash
cd "C:\Users\Dmitri.MARKIT\source\repos\project-proculink"
bun run build 2>&1 | tail -10
```

Expected: 0 errors.

- [ ] **Step 4.3 — Commit**

```bash
cd "C:\Users\Dmitri.MARKIT\source\repos\project-proculink"
git add src/components/bridge/BridgeSidebar.tsx
git commit -m "fix(sidebar): accurate review badge via orders-summary endpoint"
```

---

## Task 5 — Frontend: Notifications bell unread count from summary

**Repo:** `C:\Users\Dmitri.MARKIT\source\repos\project-proculink`

**Files:**
- Modify: `src/components/bridge/BridgeTopbar.tsx`

The bell's **unread count badge** (the red number) should be accurate. The **top-7 preview list** inside the popover can stay from the 100-order working set — it's a "recent activity" preview, not an exhaustive list. This distinction is honest: users clicking "View all in inbox →" see everything.

- [ ] **Step 5.1 — Add a summary query to `NotificationsBell`**

In `BridgeTopbar.tsx`, the `NotificationsBell` function starts at line 123. Add a second query for the summary:

```typescript
function NotificationsBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Working-set for the preview list (top 7 most recent actionable items).
  const { data: ordersPage } = useQuery({
    queryKey: ["orders"],
    queryFn: () => apiClient.getOrders({ pageSize: 100 }),
    enabled: !isApiMockMode,
    staleTime: 30_000,
  });

  // Accurate total counts — drives the badge number.
  const { data: ordersSummary } = useQuery({
    queryKey: ["orders-summary"],
    queryFn: () => apiClient.getOrdersSummary(),
    staleTime: 30_000,
  });
```

- [ ] **Step 5.2 — Replace the `unread` computation**

Find the current `unread` line (around line 148):
```typescript
const unread = items.filter((i) => i.kind === "failed" || i.kind === "review").length;
```

Replace with:
```typescript
const unread = !isApiMockMode
  ? ((ordersSummary?.byStatus?.["pending_review"] ?? 0) +
     (ordersSummary?.byStatus?.["failed"] ?? 0) +
     (ordersSummary?.byStatus?.["delivery_failed"] ?? 0) +
     (ordersSummary?.byStatus?.["transform_failed"] ?? 0) +
     (ordersSummary?.byStatus?.["delivery_dead_letter"] ?? 0))
  : items.filter((i) => i.kind === "failed" || i.kind === "review").length;
```

The `items` array is still used for the popover list — keep it unchanged.

- [ ] **Step 5.3 — Build check**

```bash
bun run build 2>&1 | tail -10
```

Expected: 0 errors.

- [ ] **Step 5.4 — Commit**

```bash
git add src/components/bridge/BridgeTopbar.tsx
git commit -m "fix(notifications): accurate unread count via orders-summary"
```

---

## Task 6 — Frontend: Dashboard exceptions KPI from summary

**Repo:** `C:\Users\Dmitri.MARKIT\source\repos\project-proculink`

**Files:**
- Modify: `src/components/bridge/BridgeDashboard.tsx`

The "Urgent exceptions" KPI currently computes `openExceptionsAll` from the 100-item working set. Replace it with an accurate count from the summary.

- [ ] **Step 6.1 — Add summary query to `BridgeDashboard`**

In `BridgeDashboard.tsx`, find the existing queries (around line 227). Add a summary query alongside the existing ones:

```typescript
const { data: ordersSummary } = useQuery({
  queryKey: ["orders-summary"],
  queryFn: () => apiClient.getOrdersSummary(),
  staleTime: 60_000,
});
```

- [ ] **Step 6.2 — Replace `openExceptionsAll` computation**

Find this line (around line 285):
```typescript
const openExceptionsAll = allOrders.filter((o) => EXCEPTION_STATUSES.has(o.status)).length;
```

Replace with:
```typescript
const openExceptionsAll = !isApiMockMode
  ? ((ordersSummary?.byStatus?.["pending_review"] ?? 0) +
     (ordersSummary?.byStatus?.["failed"] ?? 0) +
     (ordersSummary?.byStatus?.["delivery_failed"] ?? 0) +
     (ordersSummary?.byStatus?.["transform_failed"] ?? 0) +
     (ordersSummary?.byStatus?.["delivery_dead_letter"] ?? 0))
  : allOrders.filter((o) => EXCEPTION_STATUSES.has(o.status)).length;
```

- [ ] **Step 6.3 — Build check**

```bash
bun run build 2>&1 | tail -10
```

Expected: 0 errors.

- [ ] **Step 6.4 — Commit**

```bash
git add src/components/bridge/BridgeDashboard.tsx
git commit -m "fix(dashboard): accurate exceptions KPI via orders-summary"
```

---

## Task 7 — Frontend: Dashboard windowed KPIs via pageSize:1 count queries

**Repo:** `C:\Users\Dmitri.MARKIT\source\repos\project-proculink`

**Files:**
- Modify: `src/components/bridge/BridgeDashboard.tsx`

"Orders received" and "Orders delivered" KPIs show counts for the selected time window. They currently read from the 100-item working set. Fix by fetching `totalCount` with a `pageSize:1` request filtered by date window and optionally status. Also add a `totalCount > 100` notice to the export button.

- [ ] **Step 7.1 — Add windowed count queries to `BridgeDashboard`**

After the summary query added in Task 6, add two more queries keyed by window:

```typescript
// Windowed "received" count — accurate total, not capped at working set.
const windowCutoffISO = useMemo(() => {
  const cutoff = windowStart(windowKey);
  return cutoff > 0 ? new Date(cutoff).toISOString() : undefined;
}, [windowKey]);

const { data: windowedReceivedPage } = useQuery({
  queryKey: ["orders-count-received", windowKey],
  queryFn: () => apiClient.getOrders({
    pageSize: 1,
    ...(windowCutoffISO ? { dateFrom: windowCutoffISO } : {}),
  }),
  staleTime: 60_000,
  enabled: !isApiMockMode,
});

const { data: windowedDeliveredPage } = useQuery({
  queryKey: ["orders-count-delivered", windowKey],
  queryFn: () => apiClient.getOrders({
    status: "delivered",
    pageSize: 1,
    ...(windowCutoffISO ? { dateFrom: windowCutoffISO } : {}),
  }),
  staleTime: 60_000,
  enabled: !isApiMockMode,
});
```

- [ ] **Step 7.2 — Replace windowed KPI values**

Find the KPIs array (around line 296). Change the first two KPI `value` fields:

**"Orders received"** — currently `fmt(windowedOrders.length)`:
```typescript
value: !isApiMockMode
  ? (ordersLoading ? "…" : ordersError ? "—" : (windowedReceivedPage?.totalCount ?? windowedOrders.length).toLocaleString())
  : fmt(windowedOrders.length),
```

**"Orders delivered"** — currently `fmt(deliveredInWindow)`:
```typescript
value: !isApiMockMode
  ? (ordersLoading ? "…" : ordersError ? "—" : (windowedDeliveredPage?.totalCount ?? deliveredInWindow).toLocaleString())
  : fmt(deliveredInWindow),
```

- [ ] **Step 7.3 — Add `totalCount > 100` note to export button**

Find the export button tooltip (around line 528) and update it to mention when data is partial:

```typescript
const exportNote = !isApiMockMode && (ordersPage?.totalCount ?? 0) > 100
  ? `Export contains the most recent 100 of ${ordersPage!.totalCount.toLocaleString()} orders in this window`
  : windowedOrders.length === 0
    ? "No orders in this window to export"
    : "Download this window's orders as CSV";
```

Then set `title={exportNote}` on the button.

- [ ] **Step 7.4 — Build check**

```bash
bun run build 2>&1 | tail -10
```

Expected: 0 errors.

- [ ] **Step 7.5 — Commit**

```bash
git add src/components/bridge/BridgeDashboard.tsx
git commit -m "fix(dashboard): accurate windowed KPI counts via pageSize:1 queries"
```

---

## Task 8 — Frontend: Dashboard topology prefers real endpoint

**Repo:** `C:\Users\Dmitri.MARKIT\source\repos\project-proculink`

**Files:**
- Modify: `src/components/bridge/BridgeDashboard.tsx`

The current priority is `derived (100 orders) > endpoint (was empty) > empty`. Now that the endpoint is real, flip priority to `endpoint > derived (fallback) > empty`.

- [ ] **Step 8.1 — Flip topology priority in `BridgeDashboard.tsx`**

Find this line (around line 274):
```typescript
const effective: DerivedTopology = derivedHasData ? derived : endpointHasData ? endpoint : { buyers: [], suppliers: [], wires: [] };
```

Replace with:
```typescript
// Prefer server-side topology (all orders) over client-derived (capped at working set).
const effective: DerivedTopology = endpointHasData ? endpoint : derivedHasData ? derived : { buyers: [], suppliers: [], wires: [] };
```

- [ ] **Step 8.2 — Build check**

```bash
bun run build 2>&1 | tail -10
```

Expected: 0 errors.

- [ ] **Step 8.3 — Commit**

```bash
git add src/components/bridge/BridgeDashboard.tsx
git commit -m "fix(dashboard): prefer server-side topology over client-derived 100-order view"
```

---

## Task 9 — Frontend: Command palette server-side search

**Repo:** `C:\Users\Dmitri.MARKIT\source\repos\project-proculink`

**Files:**
- Modify: `src/components/bridge/CommandPalette.tsx`

Currently the palette searches the 100-item working set. Any order beyond the first 100 is invisible. Fix: when the user types ≥2 characters, fire a server-side `getOrders({ search: q, pageSize: 8 })` query. For an empty query, keep the first-6-recent display from the working set.

- [ ] **Step 9.1 — Add debounced search state and query to `CommandPalette.tsx`**

At the top of the `CommandPalette` component function (after the existing state declarations, around line 101), add:

```typescript
// Debounce the user's query before firing a server search — avoids a request
// per keystroke.
const [debouncedQ, setDebouncedQ] = useState("");
useEffect(() => {
  if (q.length < 2) { setDebouncedQ(""); return; }
  const t = setTimeout(() => setDebouncedQ(q), 200);
  return () => clearTimeout(t);
}, [q]);

const { data: searchPage } = useQuery({
  queryKey: ["orders-search", debouncedQ],
  queryFn: () => apiClient.getOrders({ search: debouncedQ, pageSize: 8 }),
  staleTime: 30_000,
  enabled: !isApiMockMode && debouncedQ.length >= 2,
});
```

- [ ] **Step 9.2 — Use server search results when available in `buildIndex`**

Find the `items` line (around line 123):
```typescript
const items = buildIndex(router, ordersPage?.items ?? [], suppliers ?? [], buyers ?? []);
```

Replace with:
```typescript
// When a search term is active and server results are available, use them.
// Otherwise fall back to the working-set slice (empty query = show recent).
const orderResults: OrderSummary[] = debouncedQ.length >= 2 && !isApiMockMode
  ? (searchPage?.items ?? [])
  : (ordersPage?.items ?? []).slice(0, 6);

const items = buildIndex(router, orderResults, suppliers ?? [], buyers ?? []);
```

The `buildIndex` function already calls `.slice(0, 6)` on orders — but now we pass server search results for typed queries. Adjust `buildIndex` to not re-slice when it already has a bounded result:

Find in `buildIndex` (around line 54):
```typescript
const orderItems: CmdItem[] = orders.slice(0, 6).map((order) => ({
```

Change to:
```typescript
const orderItems: CmdItem[] = orders.map((order) => ({
```

(Slicing is now handled at the call site — server search returns max 8, working-set slice is 6.)

- [ ] **Step 9.3 — Build check**

```bash
bun run build 2>&1 | tail -10
```

Expected: 0 errors.

- [ ] **Step 9.4 — Commit**

```bash
git add src/components/bridge/CommandPalette.tsx
git commit -m "fix(command-palette): server-side search so any order is findable"
```

---

## Task 10 — Final build + verification

**Repo:** `C:\Users\Dmitri.MARKIT\source\repos\project-proculink`

- [ ] **Step 10.1 — Full build**

```bash
cd "C:\Users\Dmitri.MARKIT\source\repos\project-proculink"
bun run build 2>&1
```

Expected: all pages compiled, 0 TypeScript errors, `Route (app)` table printed.

- [ ] **Step 10.2 — Type-check only (belt-and-suspenders)**

```bash
bun run --bun tsc --noEmit 2>&1 | head -20
```

Expected: no output (no errors).

- [ ] **Step 10.3 — Confirm no mock data residue for new queries**

```bash
grep -n "isApiMockMode\|mockGetOrdersSummary\|mockGetDashboardTopology" src/lib/api-client.ts | head -20
```

Expected: `mockGetOrdersSummary` gated via `USE_MOCK ? mockGetOrdersSummary : realGetOrdersSummary`. `mockGetDashboardTopology` should only appear in mock path.

---

## Self-Review Checklist

**Spec coverage:**

| Requirement | Task |
|---|---|
| Sidebar review badge accurate | Task 4 |
| Notifications unread count accurate | Task 5 |
| Dashboard topology over all orders | Tasks 2, 3, 8 |
| Dashboard KPIs accurate | Tasks 6, 7 |
| Command palette finds any order | Task 9 |
| Upload recent unchanged (already correct) | — (no change needed) |
| `bun run build` passes | Task 10 |
| Backend `orders/summary` endpoint | Task 2 |
| Backend `dashboard/topology` endpoint | Task 2 |
| Tests for both backend endpoints | Task 2 |

**Placeholder scan:** All steps contain exact code. No "TBD" or "similar to" references.

**Type consistency:**
- `OrdersSummary.byStatus` is `Partial<Record<string, number>>` — all consumers use `?? 0` null coalescing.
- `DashboardTopologyDto` mirrors the existing `DashboardTopology` FE type — `TopologyBuyerDto`, `TopologySupplierDto`, `TopologyWireDto` field names match the camelCase FE contract (ASP.NET Core default JSON serializer uses camelCase).
- `orderResults` in CommandPalette typed as `OrderSummary[]` matching `buildIndex` parameter.

**One gap fixed:** The `dateFrom` parameter passed to `getOrders` must be in ISO-8601 string format. `windowStart()` returns an epoch ms number. Task 7 converts it correctly with `new Date(cutoff).toISOString()`.
