"use client";

import React from "react";
import Link from "next/link";
import type { OnboardingStatus } from "@/types/procurement";

interface OnboardingChecklistProps {
  status: OnboardingStatus;
  supplierCount: number;
  orderCount: number;
}

const T = {
  navy:    "#0B1A2F",
  blue:    "#1E66C9",
  green:   "#2E8E3A",
  surface: "#FFFFFF",
  surface2:"#F1F5F9",
  border:  "#E2E8F0",
  text:    "#0F172A",
  muted:   "#64748B",
};

interface Step {
  id: string;
  label: string;
  description: string;
  href: string;
  requires?: string[];
  isDone: (s: OnboardingStatus, supplierCount: number, orderCount: number) => boolean;
}

const STEPS: Step[] = [
  {
    id: "supplier",
    label: "Add your first supplier",
    description: "Create a supplier dock to hold delivery config and item mappings",
    href: "/library/suppliers",
    isDone: (_s, sc) => sc > 0,
  },
  {
    id: "upload",
    label: "Upload a sample order",
    description: "Drop a CSV, XLSX, PDF, or cXML purchase order to start",
    href: "/upload",
    isDone: (s) => s.hasUpload,
    requires: ["supplier"],
  },
  {
    id: "map",
    label: "Map supplier item codes",
    description: "Resolve any unmatched buyer → supplier item codes",
    href: "/library/mappings",
    isDone: (_s, _sc, oc) => oc > 0,
    requires: ["supplier", "upload"],
  },
  {
    id: "delivery",
    label: "Configure order delivery",
    description: "Set up how ProcuLink sends orders to each supplier",
    href: "/library/suppliers",
    isDone: (s) => s.hasDelivery,
    requires: ["supplier"],
  },
  {
    id: "send",
    label: "Send your first order",
    description: "Transform and deliver an order through the bridge",
    href: "/inbox",
    isDone: (s) => s.hasDelivery,
    requires: ["supplier", "upload", "map", "delivery"],
  },
];

export function OnboardingChecklist({ status, supplierCount, orderCount }: OnboardingChecklistProps) {
  const doneSet = new Set(
    STEPS.filter(step => step.isDone(status, supplierCount, orderCount)).map(s => s.id)
  );

  const totalDone = doneSet.size;
  const progress = (totalDone / STEPS.length) * 100;

  if (totalDone >= STEPS.length) return null;

  return (
    <div
      style={{
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderLeft: `3px solid ${T.blue}`,
        borderRadius: 8,
        padding: "20px 24px",
        maxWidth: 500,
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: 14 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: T.text, margin: 0, letterSpacing: "-0.01em" }}>
          Getting started
        </h3>
        <p style={{ fontSize: 12.5, color: T.muted, margin: "3px 0 0" }}>
          {totalDone} of {STEPS.length} steps complete
        </p>
      </div>

      {/* Progress bar */}
      <div style={{ height: 3, background: T.surface2, borderRadius: 2, marginBottom: 16, overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            width: `${progress}%`,
            background: `linear-gradient(90deg, ${T.blue}, ${T.green})`,
            borderRadius: 2,
            transition: "width 0.4s ease",
          }}
        />
      </div>

      {/* Steps */}
      <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        {STEPS.map((step) => {
          const done = doneSet.has(step.id);
          const locked = (step.requires ?? []).some(req => !doneSet.has(req));

          return (
            <li
              key={step.id}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                opacity: locked ? 0.4 : 1,
              }}
            >
              {/* Status circle */}
              <span
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: "50%",
                  border: done ? "none" : `1.8px solid ${locked ? T.border : T.blue}`,
                  background: done ? T.green : "transparent",
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginTop: 1,
                }}
              >
                {done && (
                  <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
                    <path d="M1 3.5L3.5 6L8 1" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
                {locked && !done && (
                  <svg width="8" height="9" viewBox="0 0 8 9" fill="none">
                    <rect x="0.9" y="3.8" width="6.2" height="4.5" rx="1" stroke={T.border} strokeWidth="1.3" />
                    <path d="M2.2 3.8V3a1.8 1.8 0 0 1 3.6 0v.8" stroke={T.border} strokeWidth="1.3" strokeLinecap="round" />
                  </svg>
                )}
              </span>

              {/* Content */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      color: done ? T.muted : T.text,
                      textDecoration: done ? "line-through" : "none",
                      letterSpacing: "-0.005em",
                    }}
                  >
                    {step.label}
                  </span>
                  {!done && !locked && (
                    <Link
                      href={step.href}
                      style={{
                        fontSize: 11,
                        color: T.blue,
                        textDecoration: "none",
                        fontWeight: 600,
                        whiteSpace: "nowrap",
                        letterSpacing: "0.01em",
                      }}
                    >
                      Go →
                    </Link>
                  )}
                </div>
                {!done && (
                  <p style={{ fontSize: 11.5, color: T.muted, margin: "2px 0 0", lineHeight: 1.5 }}>
                    {step.description}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
