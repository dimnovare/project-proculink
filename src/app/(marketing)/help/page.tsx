"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Fuse from "fuse.js";
import { HELP_ARTICLES, type HelpArticle } from "@/lib/help-articles";

const S = {
  page:    { maxWidth: 880, margin: "0 auto", padding: "56px 32px 80px" },
  h1:      { fontFamily: "'Bricolage Grotesque', Inter, sans-serif", fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 700, letterSpacing: "-0.025em", color: "#0B1A2F", marginBottom: 8 },
  sub:     { fontSize: 15.5, color: "#56627A", lineHeight: 1.6, marginBottom: 32 },
  search:  { width: "100%", height: 44, padding: "0 14px", border: "1px solid #E2E6EE", borderRadius: 8, fontSize: 14, marginBottom: 28, background: "#FFFFFF", color: "#0B1A2F" },
  group:   { marginBottom: 28 },
  groupTitle: { fontFamily: "'Bricolage Grotesque', Inter, sans-serif", fontSize: 13, fontWeight: 600, color: "#8A93A5", letterSpacing: "0.04em", textTransform: "uppercase" as const, marginBottom: 10 },
  card:    { display: "block", padding: "14px 16px", background: "#FFFFFF", border: "1px solid #E2E6EE", borderRadius: 8, marginBottom: 8, textDecoration: "none", color: "inherit" },
  cardTitle: { fontSize: 14.5, fontWeight: 600, color: "#0B1A2F", margin: 0 },
  cardBlurb: { fontSize: 13, color: "#56627A", margin: "4px 0 0", lineHeight: 1.5 },
  empty:   { fontSize: 13.5, color: "#8A93A5", padding: 16, textAlign: "center" as const },
};

export default function HelpIndex() {
  const [q, setQ] = useState("");

  const fuse = useMemo(() => new Fuse(HELP_ARTICLES, {
    keys: ["title", "blurb", "category"],
    threshold: 0.4,
  }), []);

  const grouped = useMemo(() => {
    const list: HelpArticle[] = q.trim() ? fuse.search(q).map(r => r.item) : HELP_ARTICLES;
    return list.reduce<Record<string, HelpArticle[]>>((acc, a) => {
      (acc[a.category] ??= []).push(a);
      return acc;
    }, {});
  }, [q, fuse]);

  return (
    <div style={S.page}>
      <h1 style={S.h1}>Help</h1>
      <p style={S.sub}>Short, focused articles for the most common ProcuLink tasks.</p>

      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search articles"
        style={S.search}
      />

      {Object.keys(grouped).length === 0 && <p style={S.empty}>No articles match &ldquo;{q}&rdquo;.</p>}

      {Object.entries(grouped).map(([cat, arts]) => (
        <div key={cat} style={S.group}>
          <h2 style={S.groupTitle}>{cat}</h2>
          {arts.map((a) => (
            <Link key={a.slug} href={`/help/${a.slug}`} style={S.card}>
              <p style={S.cardTitle}>{a.title}</p>
              <p style={S.cardBlurb}>{a.blurb}</p>
            </Link>
          ))}
        </div>
      ))}
    </div>
  );
}
