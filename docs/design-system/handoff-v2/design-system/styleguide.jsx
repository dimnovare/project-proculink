// styleguide.jsx — living visual reference. Renders the real window.PL primitives.
const { T, Mark, LinkSpine, Icon, ConfidenceChip, SrcChip, Pill, Button, Card, Toggle, Picker, Tabs, AiSuggestion, EmptyState, SectionTitle } = window.PL;
const mono = { fontFamily: T.mono, fontVariantNumeric: "tabular-nums" };

/* ---- layout helpers ---- */
function Section({ id, n, title, sub, children }) {
  return (
    <section id={id} style={{ marginBottom: 46 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 4 }}>
        <span style={{ ...mono, fontSize: 12, fontWeight: 700, color: T.inkFaint }}>{n}</span>
        <h2 style={{ margin: 0, fontFamily: T.display, fontWeight: 750, fontSize: 25, letterSpacing: "-0.02em", color: T.ink }}>{title}</h2>
      </div>
      {sub && <p style={{ margin: "0 0 18px 36px", fontSize: 13.5, color: T.inkMuted, maxWidth: 640, lineHeight: 1.5 }}>{sub}</p>}
      <div style={{ marginLeft: 36 }}>{children}</div>
    </section>
  );
}
function Block({ label, children, style }) {
  return (
    <div style={{ marginBottom: 20 }}>
      {label && <div style={{ ...mono, fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: T.inkFaint, marginBottom: 10 }}>{label}</div>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", ...style }}>{children}</div>
    </div>
  );
}
function Panel({ children, style }) {
  return <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, boxShadow: T.shadow, padding: 20, ...style }}>{children}</div>;
}

/* ---- color swatch ---- */
function Swatch({ name, val, ink }) {
  return (
    <div style={{ width: 150 }}>
      <div style={{ height: 56, borderRadius: 10, background: val, border: `1px solid ${T.border}`, boxShadow: "inset 0 0 0 1px rgba(11,26,47,0.03)" }}/>
      <div style={{ marginTop: 7, fontSize: 12, fontWeight: 600, color: T.ink }}>{name}</div>
      <div style={{ ...mono, fontSize: 11, color: T.inkMuted, textTransform: "uppercase" }}>{val}</div>
    </div>
  );
}
const GROUPS = [
  ["Buyer · source", [["blue", T.blue], ["blueDeep", T.blueDeep], ["blueSoft", T.blueSoft]]],
  ["Supplier · output", [["green", T.green], ["greenDeep", T.greenDeep], ["greenSoft", T.greenSoft]]],
  ["Status", [["amber", T.amber], ["amberSoft", T.amberSoft], ["danger", T.danger], ["dangerSoft", T.dangerSoft], ["ai", T.ai], ["aiSoft", T.aiSoft]]],
  ["App chrome · navy", [["navy", T.navy], ["navySurface", T.navySurface], ["navyBorder", T.navyBorder]]],
  ["Surfaces & ink", [["bg", T.bg], ["surface2", T.surface2], ["border", T.border], ["ink", T.ink], ["inkMuted", T.inkMuted], ["inkFaint", T.inkFaint]]],
];

/* ---- type specimen ---- */
function Type({ font, size, weight, tracking, label, sample }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 18, padding: "11px 0", borderBottom: `1px solid ${T.borderFaint}` }}>
      <div style={{ width: 132, flexShrink: 0, ...mono, fontSize: 11, color: T.inkMuted }}>{label}</div>
      <div style={{ fontFamily: font, fontSize: size, fontWeight: weight, letterSpacing: tracking, color: T.ink, lineHeight: 1.1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sample}</div>
    </div>
  );
}

/* ---- sample table (fixed grid + status system) ---- */
const ROWS = [
  ["4500291847", "Nordic Electronics", "CSV", "Delivered", T.green, "14:02"],
  ["4500291848", "Baltic Steel", "cXML", "Needs review", T.amber, "13:47"],
  ["4500291849", "Westfält AB", "PDF", "Failed — endpoint refused", T.danger, "13:31"],
  ["4500291850", "Acme Components", "UBL", "Ready", T.blue, "13:18"],
];
function SampleTable() {
  const cols = "132px 1fr 64px 240px 64px";
  return (
    <div style={{ border: `1px solid ${T.border}`, borderRadius: 12, overflow: "hidden", boxShadow: T.shadow }}>
      <div style={{ display: "grid", gridTemplateColumns: cols, gap: 12, padding: "9px 16px", background: T.surface2, borderBottom: `1px solid ${T.border}` }}>
        {[["PO number", T.blue], ["Buyer", null], ["Format", null], ["Status", null], ["Time", null]].map(([h, dot], i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: T.inkFaint }}>
            {dot && <span style={{ width: 6, height: 6, borderRadius: "50%", background: dot }}/>}{h}
          </div>
        ))}
      </div>
      {ROWS.map((r, i) => (
        <div key={i} className="wb-rowhover" style={{ display: "grid", gridTemplateColumns: cols, gap: 12, padding: "13px 16px", alignItems: "center", background: T.surface, borderBottom: i < ROWS.length - 1 ? `1px solid ${T.borderFaint}` : "none", cursor: "pointer" }}
          onMouseEnter={e => e.currentTarget.style.background = T.surface2} onMouseLeave={e => e.currentTarget.style.background = T.surface}>
          <span style={{ ...mono, fontSize: 12.5, color: T.ink }}>{r[0]}</span>
          <span style={{ fontSize: 13, fontWeight: 500, color: T.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r[1]}</span>
          <SrcChip type={r[2]}/>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 7, minWidth: 0 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: r[4], flexShrink: 0 }}/>
            <span style={{ fontSize: 12.5, fontWeight: 550, color: r[4] === T.amber ? T.amber : r[4] === T.danger ? T.danger : r[4] === T.green ? T.greenDeep : T.blueDeep, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r[3]}</span>
          </span>
          <span style={{ ...mono, fontSize: 12, color: T.inkMuted }}>{r[5]}</span>
        </div>
      ))}
    </div>
  );
}

function Styleguide() {
  const [tab, setTab] = React.useState("all");
  const [tog, setTog] = React.useState(true);
  const [pick, setPick] = React.useState("map");
  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "0 32px 90px" }}>
      {/* header */}
      <header style={{ display: "flex", alignItems: "center", gap: 14, padding: "30px 0 22px", borderBottom: `1px solid ${T.border}`, marginBottom: 36, position: "sticky", top: 0, background: "#F6F7FAF2", backdropFilter: "blur(8px)", zIndex: 10 }}>
        <span style={{ width: 44, height: 44, borderRadius: 11, background: T.navy, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Mark size={26}/></span>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: T.display, fontWeight: 800, fontSize: 21, letterSpacing: "-0.02em", color: T.ink }}>ProcuLink Design System</div>
          <div style={{ fontSize: 12.5, color: T.inkMuted }}>“The Bridge Layer” · living styleguide · blue = buyer, green = supplier</div>
        </div>
        <Pill tone="blue" icon={<Icon.CheckCircle s={11} c={T.blueDeep}/>}>v2</Pill>
      </header>

      {/* hero spine */}
      <div style={{ marginBottom: 40 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "22px 26px", background: T.navy, borderRadius: 16, boxShadow: T.shadowLg }}>
          <div style={{ textAlign: "center" }}><div style={{ ...mono, fontSize: 10, color: T.navyMuted, marginBottom: 6, letterSpacing: "0.1em" }}>BUYER PO</div><span style={{ display: "inline-block", width: 12, height: 12, borderRadius: "50%", background: T.blue, boxShadow: "0 0 0 4px rgba(30,102,201,0.25)" }}/></div>
          <div style={{ flex: 1, height: 3, borderRadius: 3, background: T.linkGradient }}/>
          <div style={{ textAlign: "center" }}><div style={{ ...mono, fontSize: 10, color: T.navyMuted, marginBottom: 6, letterSpacing: "0.1em" }}>TRANSFORM</div><span style={{ display: "inline-block", padding: "5px 12px", borderRadius: 999, background: T.navySurface, border: `1px solid ${T.navyBorder}`, color: "#fff", fontSize: 12, fontWeight: 600 }}>ProcuLink</span></div>
          <div style={{ flex: 1, height: 3, borderRadius: 3, background: T.linkGradient }}/>
          <div style={{ textAlign: "center" }}><div style={{ ...mono, fontSize: 10, color: T.navyMuted, marginBottom: 6, letterSpacing: "0.1em" }}>SUPPLIER OUT</div><span style={{ display: "inline-block", width: 12, height: 12, borderRadius: "50%", background: T.green, boxShadow: "0 0 0 4px rgba(46,142,58,0.25)" }}/></div>
        </div>
      </div>

      <Section id="color" n="01" title="Color" sub="Semantic law: blue = buyer/source, green = supplier/output, amber = uncertain, red = blocker, violet = AI, navy = chrome. Solid for the acting element; soft tints behind status.">
        {GROUPS.map(([g, sw]) => <Block key={g} label={g}>{sw.map(([n, v]) => <Swatch key={n} name={n} val={v}/>)}</Block>)}
      </Section>

      <Section id="type" n="02" title="Typography" sub="Bricolage Grotesque (display) · Inter (text) · JetBrains Mono (data & figures). Floor for live UI text: 11.5px; table cells 12.5px.">
        <Panel style={{ padding: "6px 22px 14px" }}>
          <Type label="Display / 48" font={T.display} size={44} weight={800} tracking="-0.025em" sample="Get orders supplier-ready"/>
          <Type label="H1 / 32" font={T.display} size={31} weight={750} tracking="-0.025em" sample="Work Queue"/>
          <Type label="H2 / 22" font={T.display} size={22} weight={700} tracking="-0.02em" sample="Delivery log"/>
          <Type label="H3 / 18" font={T.display} size={18} weight={650} tracking="-0.015em" sample="Supplier readiness"/>
          <Type label="Body / 13 (Inter)" font={T.ui} size={13} weight={450} tracking="0" sample="Map each field once — every future order reuses it."/>
          <Type label="Mono / 12.5" font={T.mono} size={12.5} weight={500} tracking="0" sample="4500291847 · cXML · OrderRequestHeader/@orderID"/>
        </Panel>
      </Section>

      <Section id="elevation" n="03" title="Elevation & radius" sub="One shadow ladder — no ad-hoc shadows. Cards lift to shadow-md on hover.">
        <Block>
          {[["sm", T.shadowSm], ["DEFAULT", T.shadow], ["md", T.shadowMd], ["lg", T.shadowLg], ["xl", T.shadowXl]].map(([n, s]) => (
            <div key={n} style={{ width: 150, height: 78, borderRadius: 14, background: T.surface, border: `1px solid ${T.border}`, boxShadow: s, display: "flex", alignItems: "center", justifyContent: "center", ...mono, fontSize: 12, color: T.inkMuted }}>shadow-{n}</div>
          ))}
        </Block>
        <Block label="Radius">
          {[["sm 4", 4], ["md 8", 8], ["lg 10", 10], ["xl 12", 12], ["2xl 14", 14], ["full", 999]].map(([n, r]) => (
            <div key={n} style={{ padding: "8px 14px", borderRadius: r, background: T.surface2, border: `1px solid ${T.border}`, fontSize: 12, color: T.inkMuted }}>{n}</div>
          ))}
        </Block>
      </Section>

      <Section id="buttons" n="04" title="Buttons" sub="One taxonomy. primary = navy · send = green · ai = violet · danger = red · secondary · ghost. Sizes sm / md / lg. Filled variants carry ambient depth.">
        <Panel>
          <Block label="Variants (md)">
            <Button variant="primary" icon={<Icon.Upload s={14} c="#fff"/>}>Upload order</Button>
            <Button variant="send" icon={<Icon.Send s={13} c="#fff"/>}>Send to supplier</Button>
            <Button variant="ai" icon={<Icon.Sparkle s={12} c="#fff"/>}>Accept suggestion</Button>
            <Button variant="danger" icon={<Icon.Warn s={13} c="#fff"/>}>Delete route</Button>
            <Button variant="secondary" icon={<Icon.Eye s={13} c={T.ink}/>}>Preview</Button>
            <Button variant="ghost">Cancel</Button>
          </Block>
          <Block label="Sizes & states">
            <Button size="sm" variant="primary">Small</Button>
            <Button size="md" variant="primary">Medium</Button>
            <Button size="lg" variant="primary">Large</Button>
            <Button variant="send" disabled>Resolve blockers to send</Button>
            <Button variant="secondary" iconRight={<Icon.ArrowRight s={13} c={T.ink}/>}>Continue</Button>
          </Block>
        </Panel>
      </Section>

      <Section id="status" n="05" title="Status & chips" sub="The single status set — always dot/icon AND word, never color alone. Confidence and format chips are mono.">
        <Panel>
          <Block label="Order lifecycle">
            <Pill tone="neutral" icon={<Icon.Doc s={11} c={T.inkMuted}/>}>Received</Pill>
            <Pill tone="amber" icon={<Icon.Warn s={11} c={T.amber}/>}>Needs review</Pill>
            <Pill tone="blue" icon={<Icon.CheckCircle s={11} c={T.blueDeep}/>}>Ready</Pill>
            <Pill tone="green" icon={<Icon.Send s={11} c={T.greenDeep}/>}>Sent</Pill>
            <Pill tone="green" icon={<Icon.Check s={11} c={T.greenDeep}/>}>Delivered</Pill>
            <Pill tone="danger" icon={<Icon.Warn s={11} c={T.danger}/>}>Failed</Pill>
            <Pill tone="danger" icon={<Icon.X s={10} c={T.danger}/>}>Rejected</Pill>
          </Block>
          <Block label="Confidence">
            <ConfidenceChip value={98}/><ConfidenceChip value={82}/><ConfidenceChip value={64}/>
          </Block>
          <Block label="Source formats">
            {["PDF", "CSV", "XLSX", "XML", "cXML", "UBL", "X12", "EDI", "EMAIL", "API", "JSON"].map(f => <SrcChip key={f} type={f}/>)}
          </Block>
        </Panel>
      </Section>

      <Section id="cards" n="06" title="Cards & edges" sub="One card. Optional 3px left edge encodes the bridge side: blue = buyer, green = supplier, gradient = the transform.">
        <Block style={{ alignItems: "stretch" }}>
          <Card edge="buyer" pad={16} hover style={{ width: 236 }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: T.blueDeep, marginBottom: 6 }}>Buyer · source</div>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: T.ink }}>Nordic Electronics</div>
            <div style={{ ...mono, fontSize: 12, color: T.inkMuted, marginTop: 3 }}>PO 4500291847 · CSV</div>
          </Card>
          <Card edge="bridge" pad={16} hover style={{ width: 236 }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: T.inkMuted, marginBottom: 6 }}>Transform</div>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: T.ink }}>16 fields mapped</div>
            <div style={{ ...mono, fontSize: 12, color: T.inkMuted, marginTop: 3 }}>13 auto · 3 assisted</div>
          </Card>
          <Card edge="supplier" pad={16} hover style={{ width: 236 }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: T.greenDeep, marginBottom: 6 }}>Supplier · output</div>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: T.ink }}>Acme Components</div>
            <div style={{ ...mono, fontSize: 12, color: T.inkMuted, marginTop: 3 }}>cXML 1.2 · HTTPS</div>
          </Card>
        </Block>
      </Section>

      <Section id="forms" n="07" title="Forms & controls" sub="Styled select (Picker) with buyer/supplier accent, toggle, and underline tabs with count badges.">
        <Panel>
          <Block label="Picker · Toggle · Tabs">
            <Picker value={pick} tone="supplier" onChange={setPick} options={[{ v: "map", l: "Map from PO number" }, { v: "fixed", l: "Fixed value" }, { v: "", l: "Leave empty" }]}/>
            <Toggle on={tog} onChange={setTog} label="Auto-send when ready" sub="Only after all rules pass"/>
          </Block>
          <div style={{ marginTop: 6 }}>
            <Tabs value={tab} onChange={setTab} tabs={[{ k: "all", label: "All" }, { k: "review", label: "Needs review", badge: 5 }, { k: "ready", label: "Ready", badge: 9 }, { k: "sent", label: "Sent" }]}/>
          </div>
        </Panel>
      </Section>

      <Section id="ai" n="08" title="AI assist" sub="Violet, honest, and reversible. Confidence shown; actions are Accept / Edit / Dismiss. Assisted ≠ automated.">
        <div style={{ maxWidth: 460 }}>
          <AiSuggestion confidence={88} source="from delivery address" onAccept={() => {}} onEdit={() => {}} onReject={() => {}}>
            Map <b>Ship-to code</b> → <span style={mono}>OSLO-DC2</span> from the buyer’s delivery text.
          </AiSuggestion>
        </div>
      </Section>

      <Section id="states" n="09" title="States: empty · loading · error · success" sub="Every list and detail ships all four. Empty teaches; loading uses skeletons; error names cause + fix; success gives a durable proof affordance.">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <Panel style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ ...mono, fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: T.inkFaint, padding: "10px 16px", borderBottom: `1px solid ${T.borderFaint}` }}>Empty</div>
            <EmptyState icon={<Icon.Orders s={22} c={T.inkFaint}/>} title="No orders yet" sub="Upload your first purchase order and ProcuLink will detect its fields automatically." action={<Button variant="primary" icon={<Icon.Upload s={14} c="#fff"/>}>Upload order</Button>}/>
          </Panel>
          <Panel style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ ...mono, fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: T.inkFaint, padding: "10px 16px", borderBottom: `1px solid ${T.borderFaint}` }}>Loading (skeleton)</div>
            <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div className="sg-sk" style={{ width: 90, height: 12, borderRadius: 4 }}/>
                  <div className="sg-sk" style={{ flex: 1, height: 12, borderRadius: 4 }}/>
                  <div className="sg-sk" style={{ width: 56, height: 18, borderRadius: 999 }}/>
                </div>
              ))}
            </div>
          </Panel>
          <Panel style={{ borderColor: T.danger + "55", background: T.dangerSoft + "55" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 11 }}>
              <span style={{ width: 30, height: 30, borderRadius: 8, background: T.dangerSoft, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icon.Warn s={15} c={T.danger}/></span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 650, color: T.danger }}>Delivery failed</div>
                <div style={{ fontSize: 12.5, color: T.inkMuted, marginTop: 2, lineHeight: 1.45 }}>The supplier endpoint refused the connection. Check the SFTP host in Settings.</div>
                <div style={{ marginTop: 10 }}><Button size="sm" variant="secondary" icon={<Icon.Refresh s={12} c={T.ink}/>}>Retry delivery</Button></div>
              </div>
            </div>
          </Panel>
          <Panel style={{ borderColor: T.green + "55", background: T.greenSoft + "44" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 11 }}>
              <span style={{ width: 30, height: 30, borderRadius: 8, background: T.greenSoft, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icon.CheckCircle s={16} c={T.greenDeep}/></span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 650, color: T.greenDeep }}>Sent to Acme Components — acknowledged</div>
                <div style={{ ...mono, fontSize: 12, color: T.inkMuted, marginTop: 2 }}>14:02:11 · cXML over HTTPS · 200 OK</div>
                <div style={{ marginTop: 10 }}><Button size="sm" variant="secondary" icon={<Icon.Doc s={12} c={T.ink}/>}>View proof</Button></div>
              </div>
            </div>
          </Panel>
        </div>
      </Section>

      <Section id="table" n="10" title="Tables & lists" sub="Fixed column grid so data never swims. Tinted header with a source dot, mono figures, row status = dot + word, hover tint.">
        <SampleTable/>
      </Section>

      <footer style={{ marginTop: 20, marginLeft: 36, paddingTop: 22, borderTop: `1px solid ${T.border}`, fontSize: 12.5, color: T.inkMuted, lineHeight: 1.6 }}>
        <b style={{ color: T.ink }}>Semantic law</b> — blue = buyer/source · green = supplier/output · amber = uncertain · red = blocker · violet = AI · navy = chrome.
        Status is always a dot/icon <b>and</b> a word. Figures are <span style={mono}>tabular-nums</span>; IDs & payloads are mono.
        <div style={{ marginTop: 8 }}>Tokens in <span style={mono}>tokens.css</span> · shadcn mapping in <span style={mono}>shadcn-theme.css</span> · Tailwind in <span style={mono}>tailwind.preset.ts</span> · rules in <span style={mono}>DESIGN_SYSTEM.md</span> · product in <span style={mono}>FABLE5_BRIEF.md</span>.</div>
      </footer>
    </div>
  );
}
const style = document.createElement("style");
style.textContent = "@keyframes sg-shimmer{0%{background-position:-400px 0}100%{background-position:400px 0}} .sg-sk{background:linear-gradient(90deg,#EEF0F4 0%,#F6F7FA 50%,#EEF0F4 100%);background-size:800px 100%;animation:sg-shimmer 1.4s linear infinite} .wb-rowhover{transition:background .12s ease}";
document.head.appendChild(style);
ReactDOM.createRoot(document.getElementById("root")).render(<Styleguide/>);
