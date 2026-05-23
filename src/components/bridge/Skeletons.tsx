"use client";

// AC4 — Loading skeleton components for each major screen
// Pulse animation via Tailwind animate-pulse; shape matches real content geometry

// ─── Base pulse block ─────────────────────────────────────────────────────────

function Bone({
  w = "100%",
  h = 14,
  radius = 4,
  className = "",
}: {
  w?: number | string;
  h?: number;
  radius?: number;
  className?: string;
}) {
  return (
    <div
      className={`animate-pulse ${className}`}
      style={{
        width: w,
        height: h,
        borderRadius: radius,
        background: "#EDF0F5",
        flexShrink: 0,
      }}
    />
  );
}

// ─── Inbox skeleton ───────────────────────────────────────────────────────────

export function InboxSkeleton() {
  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: "#F6F7FA" }}>
      {/* Header */}
      <div className="px-6 py-4 flex items-end gap-4" style={{ borderBottom: "1px solid #E2E6EE", background: "#FFFFFF" }}>
        <div className="flex flex-col gap-2">
          <Bone w={100} h={22} />
          <Bone w={220} h={12} />
        </div>
        <div className="ml-auto flex gap-2">
          <Bone w={64} h={32} radius={6} />
          <Bone w={72} h={32} radius={6} />
          <Bone w={120} h={32} radius={6} />
        </div>
      </div>
      {/* Filter bar */}
      <div className="flex items-center gap-2 px-5" style={{ height: 44, borderBottom: "1px solid #E2E6EE", background: "#FFFFFF" }}>
        {[48, 40, 90, 56, 52, 48, 52].map((w, i) => <Bone key={i} w={w} h={24} radius={5} />)}
      </div>
      {/* Time strip */}
      <div className="flex items-center gap-3 px-6" style={{ height: 52, borderBottom: "1px solid #E2E6EE", background: "#FFFFFF" }}>
        <Bone w={80} h={10} />
        <Bone w="100%" h={24} radius={3} />
        <Bone w={100} h={10} />
      </div>
      {/* Table header */}
      <div className="flex gap-4 px-3 py-2" style={{ borderBottom: "2px solid #E2E6EE", background: "#FFFFFF" }}>
        {[36, 100, 56, 56, 180, 160, 130, 44, 90, 52, 64].map((w, i) => (
          <Bone key={i} w={w} h={10} />
        ))}
      </div>
      {/* Table rows */}
      <div className="flex-1 overflow-hidden" style={{ background: "#FFFFFF" }}>
        {Array.from({ length: 14 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 px-3"
            style={{ height: 38, borderBottom: "1px solid #F0F2F6" }}
          >
            <Bone w={13} h={13} radius={2} />
            <Bone w={88} h={18} radius={4} />
            <Bone w={32} h={12} />
            <Bone w={44} h={18} radius={3} />
            <Bone w={140} h={12} />
            <Bone w={110} h={12} />
            <Bone w={100} h={11} />
            <Bone w={24} h={12} />
            <Bone w={70} h={11} />
            <Bone w={20} h={12} />
            <Bone w={24} h={12} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Spine Review (order detail) skeleton ─────────────────────────────────────

export function SpineReviewSkeleton() {
  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: "#F6F7FA" }}>
      {/* Header */}
      <div className="px-6 py-4 flex items-center gap-4" style={{ borderBottom: "1px solid #E2E6EE", background: "#FFFFFF" }}>
        <Bone w={28} h={28} radius={6} />
        <div className="flex flex-col gap-2">
          <Bone w={180} h={16} />
          <Bone w={300} h={11} />
        </div>
        <div className="ml-auto flex gap-2">
          <Bone w={88} h={30} radius={6} />
          <Bone w={88} h={30} radius={6} />
        </div>
      </div>
      {/* 3 columns */}
      <div className="flex flex-1 min-h-0 gap-3 p-4">
        {[0, 1, 2].map((col) => (
          <div key={col} className="flex-1 flex flex-col gap-3" style={{ background: "#FFFFFF", borderRadius: 8, border: "1px solid #E2E6EE", padding: 16 }}>
            <Bone w={120} h={13} />
            <Bone w="90%" h={11} />
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex justify-between items-center">
                <Bone w={`${50 + (i * 13) % 30}%`} h={11} />
                <Bone w={`${20 + (i * 7) % 25}%`} h={11} />
              </div>
            ))}
            <Bone w="100%" h={80} radius={6} className="mt-2" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Dashboard skeleton ───────────────────────────────────────────────────────

export function DashboardSkeleton() {
  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: "#F6F7FA" }}>
      <div className="px-6 py-4" style={{ borderBottom: "1px solid #E2E6EE", background: "#FFFFFF" }}>
        <Bone w={140} h={22} />
        <Bone w={260} h={12} className="mt-2" />
      </div>
      <div className="p-5 flex flex-col gap-4 flex-1">
        {/* KPI strip */}
        <div className="grid grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} style={{ background: "#FFFFFF", border: "1px solid #E2E6EE", borderRadius: 8, padding: 16 }}>
              <Bone w={80} h={10} className="mb-3" />
              <Bone w={60} h={28} />
              <Bone w={100} h={10} className="mt-2" />
            </div>
          ))}
        </div>
        {/* Wire topology */}
        <div style={{ background: "#FFFFFF", border: "1px solid #E2E6EE", borderRadius: 8, padding: 20 }}>
          <Bone w={120} h={13} className="mb-4" />
          <Bone w="100%" h={200} radius={6} />
        </div>
        {/* Bottom row */}
        <div className="grid grid-cols-2 gap-3 flex-1">
          {[0, 1].map((i) => (
            <div key={i} style={{ background: "#FFFFFF", border: "1px solid #E2E6EE", borderRadius: 8, padding: 16 }}>
              <Bone w={100} h={13} className="mb-4" />
              {Array.from({ length: 4 }).map((_, j) => (
                <div key={j} className="flex justify-between items-center mb-3">
                  <Bone w="55%" h={12} />
                  <Bone w="30%" h={12} />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Supplier Dock Profile skeleton ──────────────────────────────────────────

export function SupplierProfileSkeleton() {
  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: "#F6F7FA" }}>
      <div className="px-6 py-4 flex items-center gap-3" style={{ borderBottom: "1px solid #E2E6EE", background: "#FFFFFF" }}>
        <Bone w={28} h={28} radius={6} />
        <div className="flex flex-col gap-2">
          <Bone w={200} h={18} />
          <Bone w={120} h={12} />
        </div>
        <div className="ml-auto flex gap-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} style={{ padding: "12px 20px", background: "#FFFFFF", border: "1px solid #E2E6EE", borderRadius: 8 }}>
              <Bone w={32} h={24} className="mb-1" />
              <Bone w={60} h={10} />
            </div>
          ))}
        </div>
      </div>
      {/* Tab bar */}
      <div className="flex gap-4 px-6" style={{ borderBottom: "1px solid #E2E6EE", background: "#FFFFFF", height: 44 }}>
        {[0, 1, 2, 3, 4, 5].map((i) => <Bone key={i} w={72} h={14} className="self-center" />)}
      </div>
      <div className="p-5 flex gap-4">
        <div className="flex-1 flex flex-col gap-3" style={{ background: "#FFFFFF", border: "1px solid #E2E6EE", borderRadius: 8, padding: 16 }}>
          <Bone w={130} h={13} />
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex justify-between items-center py-1" style={{ borderBottom: "1px solid #F0F2F6" }}>
              <Bone w="40%" h={12} />
              <Bone w="25%" h={18} radius={4} />
            </div>
          ))}
        </div>
        <div className="w-72 flex flex-col gap-3" style={{ background: "#FFFFFF", border: "1px solid #E2E6EE", borderRadius: 8, padding: 16 }}>
          <Bone w={100} h={13} />
          <Bone w="100%" h={120} radius={4} />
        </div>
      </div>
    </div>
  );
}

// ─── Generic table skeleton ───────────────────────────────────────────────────

export function TableSkeleton({ rows = 10, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div style={{ background: "#FFFFFF", border: "1px solid #E2E6EE", borderRadius: 8, overflow: "hidden" }}>
      {/* Header */}
      <div className="flex gap-4 px-4 py-3" style={{ borderBottom: "2px solid #E2E6EE" }}>
        {Array.from({ length: cols }).map((_, i) => <Bone key={i} w={60 + (i * 17) % 60} h={10} />)}
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4 px-4 py-3" style={{ borderBottom: "1px solid #F0F2F6" }}>
          {Array.from({ length: cols }).map((_, c) => (
            <Bone key={c} w={`${Math.max(40, 100 - (c * 8 + r * 3) % 55)}%`} h={12} />
          ))}
        </div>
      ))}
    </div>
  );
}
