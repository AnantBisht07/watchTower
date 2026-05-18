# Watchtower UI — Design Plan

A strategic UI plan written from the lead designer's perspective: what's wrong with the current UI, what principles should drive the next version, how the information architecture should evolve, and a phased rollout.

---

## 1. What's working / what's broken today

**Working:**
- The "control tower" metaphor — dark, calm, dense — fits the product personality
- Real-time SSE event stream feels alive
- Header → RunHero → Timeline + Inspector flow is intuitive for a single live run

**Broken or missing:**
1. **Single-run trap** — the UI assumes one run at a time, but we now support concurrent + historical runs. There's no fleet view, no comparison, no search.
2. **Reliability and Health sit below the fold** — they should be first-class observability surfaces, not appendices to a run.
3. **Approval UX is buried** — when an agent is paused waiting for you, the decision should *find you*, not the other way around. Currently it's a small panel inside the Inspector.
4. **No replay / scrubbing** — completed runs are just a static event log. There's no way to scrub the timeline, jump to a moment, or step through.
5. **No filtering on the event stream** — every event is shown; in a 200-event run it becomes noise.
6. **No policy editor in UI** — safety rules require editing `policy.yaml` by hand.
7. **Inspector is overloaded** — it shows event details, approval controls, run metadata, server info, all crammed into one column.
8. **No system-level overview** — when you open the app, you land in *some* run; you never see "what is happening across everything?"

---

## 2. Design principles

These are the values every screen has to obey:

1. **Confidence over enthusiasm** — Datadog calm, not Vercel sparkle. Muted palette, decisive typography, no gradients-for-vibe.
2. **Live truth, never stale** — every surface auto-updates. No refresh button should ever be needed for normal use.
3. **Surface intent, not just history** — when an agent *wants* to do something risky, that intent is the headline. The completed event is the receipt.
4. **One-keystroke escalation** — approve = `A`, reject = `R`, jump-to-pending = `P`. Operators live on the keyboard.
5. **Everything inspectable** — every event opens to raw JSON; every tool call links to its server's stats; every run is exportable.
6. **Density with breathing room** — high information per pixel, but never cluttered. Whitespace is a load-bearing element.

---

## 3. Personas & primary jobs

| Persona | Their job | What they need from the UI |
|---|---|---|
| **The Operator** | Babysits a running agent in prod | "Is everything healthy? Is anything waiting on me? Did anything fail?" — at a glance, on a wall display |
| **The Builder** | Develops & debugs the agent | "Why did this tool call fail? What did the agent send? Show me the same run yesterday." — deep introspection, replay |
| **The Auditor** | Reviews after the fact for compliance / cost | "Show me every approval decision last week. Export this run. Search for tool=`delete_*`." — search, filter, export |

The current UI serves the **Builder** well, the **Operator** partially, and the **Auditor** not at all.

---

## 4. New Information Architecture

Move from a one-screen app to a 5-section product, accessed via a slim left nav:

```
┌─────────────────────────────────────────────────────────┐
│ ⌖ Mission Control   ← landing; cross-run overview      │
│ ◷ Runs              ← list + detail (today's UI lives) │
│ ◉ Servers           ← MCP server fleet                  │
│ ⏸ Approvals         ← queue + history                   │
│ ⚙ Policies          ← view/edit safety rules           │
│ ⋯ Settings          ← auth, webhooks, exporters         │
└─────────────────────────────────────────────────────────┘
```

The nav is collapsed by default on small screens; expanded on wide displays. Active section is teal-underlined, not filled.

---

## 5. The five key screens

### 5.1 Mission Control (new — the landing page)

The bridge of the watchtower. What an Operator sees when they open the laptop in the morning.

```
┌────────────────────────────────────────────────────────────────────────┐
│  Mission Control                                  ⏸ 2 pending approvals│
│                                                                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────────┐  │
│  │ 3        │  │ 47/min   │  │ 99.2%    │  │ ▁▂▅▇▅▃▂▁▂▄▆▇▅▃▂▁    │  │
│  │ active   │  │ tool     │  │ success  │  │ Calls last 10min     │  │
│  │ runs     │  │ calls    │  │ (24h)    │  │                      │  │
│  └──────────┘  └──────────┘  └──────────┘  └──────────────────────┘  │
│                                                                        │
│  ⏸ Awaiting your decision (2)                              [view all]  │
│  ┌────────────────────────────────────────────────────────────────┐   │
│  │ ● filesystem.write_file   /etc/hosts  ·  run_8a2…  ·  3s ago   │   │
│  │ ● github.delete_repo      acme/legacy  ·  run_b1f…  ·  12s ago │   │
│  └────────────────────────────────────────────────────────────────┘   │
│                                                                        │
│  Live activity                              filter: [all servers ▾]    │
│  ┌────────────────────────────────────────────────────────────────┐   │
│  │ 14:32:11  ✓ gmail.search_threads        42ms    run_8a2…       │   │
│  │ 14:32:09  ✓ filesystem.read_file       11ms    run_8a2…       │   │
│  │ 14:32:08  ⚠ brave.search    timeout   5012ms   run_b1f…       │   │
│  └────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────┘
```

Four metrics, a pending-approval queue, and a global live feed. No drilling required to know if anything's on fire.

### 5.2 Runs

Two-pane: list (left, 320px) + detail (right, fills).

- **List**: searchable, filterable (status, app_name, date range), grouped by "Today / Yesterday / Earlier"
- **Detail**: the current single-run view, *but rebuilt*:
  - **Top hero** stays (status, task, mode)
  - **Below hero**: a new **timeline scrubber** — horizontal bar showing every event as a tick, color-coded by status; drag to jump; play/pause when historical
  - **Event timeline**: now filterable by type (tool calls / health / approvals / system), risk level, server. Default hides noisy `health_check_*` events.
  - **Inspector**: stripped down to just the selected event's details + JSON tab + linked actions ("view this server", "view policy that matched")

### 5.3 Servers

A fleet table. Each row = one MCP server.

```
Server          Status    Tools   Avg latency   Success    Last call    [▾]
─────────────────────────────────────────────────────────────────────────
gmail           ● healthy   12     34ms          99.8%      2s ago
filesystem      ● healthy   8      11ms          100%       5s ago
brave-search    ⚠ degraded  3      2.1s          84.2%      1m ago
postgres        ● offline   0      —             —          3h ago
```

Click a row → drill-in with: call frequency sparkline (24h), top tools by call volume, recent errors with stack, server metadata (version, transport, auth scheme).

### 5.4 Approvals

A reviewer queue. Default tab: **Pending**. Second tab: **History**.

Each pending approval is a card, not a row — because the decision needs context:

```
┌──────────────────────────────────────────────────────────────────┐
│ ⏸  filesystem.write_file                              13s ago    │
│    Run: run_8a2… (notes-agent · "summarise inbox")               │
│    Risk: high  ·  Matched policy rule: write_file → approval     │
│                                                                  │
│    Arguments:                                                    │
│    {                                                             │
│      "path": "/etc/hosts",                                       │
│      "content": "127.0.0.1 evil.com ..."                         │
│    }                                                             │
│                                                                  │
│    [ Approve  A ]   [ Reject  R ]   [ View full run ↗ ]          │
└──────────────────────────────────────────────────────────────────┘
```

Keyboard: `↓/↑` between cards, `A/R` decides.

### 5.5 Policies

Split view: YAML editor on the left, rendered rule list on the right with chips for `allow / approval / block`.

Below the editor: a **dry-run** panel — "test this policy against the last 50 runs" — shows what would have been allowed / gated / blocked. That's the killer feature; it makes policy editing safe instead of scary.

### 5.6 Settings

A single page (not a sub-nav until it earns one): API token, webhook URLs per event type, exporter configuration (OTel endpoint, Langfuse keys), data retention, redaction rules.

---

## 6. Component & token system

We need a small, documented design system instead of one-off styles. Proposed atoms:

| Atom | Purpose | Variants |
|---|---|---|
| `MetricCard` | KPI tiles on Mission Control | with sparkline / without |
| `EventRow` | One line in any event feed | tone × selected × dense |
| `RiskTag` | Pill showing risk level | low / medium / high / blocked |
| `HealthDot` | 6px status indicator | healthy / degraded / offline / unknown |
| `Sparkline` | Inline 60×16 mini-chart | line / bar |
| `EmptyHint` | Calm empty state with one CTA | — |
| `Drawer` | Right-side slide-in inspector | sm / lg |
| `CommandPalette` | `⌘K` quick nav + search | — |

**Tokens** (consolidate what's already in `styles.css`):
- Colors: 9-step neutral, teal primary, semantic success/warning/danger, plus a 3-step accent for risk levels
- Spacing: 4-pt scale (4 / 8 / 12 / 16 / 24 / 32 / 48)
- Radii: 4 / 8 / 12 (events / cards / surfaces)
- Motion: 120ms (hover), 200ms (state), 400ms (page); ease-out for incoming, ease-in for outgoing
- Type: Inter UI / JetBrains Mono for IDs, JSON, latencies

---

## 7. Critical interactions

These three flows are the product. They have to be perfect.

**(a) Pending approval finds you**
- Persistent top banner appears whenever count > 0; click jumps to Approvals queue
- If user is idle for 10s with an approval pending, an unobtrusive modal slides in
- `⌘K → "approve"` always works as a global shortcut

**(b) Live events stream without anxiety**
- New events slide in from the top with 200ms fade + slight translate
- If user has scrolled away from "live," show a sticky "↑ 12 new events" pill — don't jerk them back
- "Pause" toggle in the corner — useful when debugging

**(c) Run replay**
- Completed runs show a play/pause button + scrubber
- Drag the scrubber: timeline highlights the event at that moment; route map animates back; inspector updates
- This single feature converts the tool from "live monitor" to "post-mortem instrument"

---

## 8. Visual language refinement

Keep the current dark theme, but tighten it:

- **Background**: `#0A0E18` (deeper than current — more "watchtower at night")
- **Surface**: `#111826` cards on a darker base; subtle 1px borders, not heavy
- **Primary teal**: `#14B8A6` — accent only, never for whole surfaces
- **Semantic**: success `#34D399`, warning `#FBBF24`, danger `#FB7185` (already close)
- **Risk colors** (new): low = neutral text, medium = amber tint, high = rose tint, blocked = solid rose
- **Light mode**: ship it. Add `prefers-color-scheme` support; the Builder persona uses light-mode IDEs.

Typography: drop body font from 14 to 13 in dense surfaces; lift headings from 16 to 18 for clearer hierarchy.

---

## 9. Accessibility & responsiveness

Currently desktop-only. Targets:
- Keyboard navigation through every interactive element (visible focus ring)
- ARIA roles on the event stream (`role="log"`, `aria-live="polite"`)
- 4.5:1 contrast minimum (the current `--text-faint` likely fails)
- Mobile breakpoint at 768px: nav collapses to bottom tab bar, two-pane Runs becomes stacked, Inspector becomes a bottom drawer

---

## 10. Phased rollout

Order matters — each phase ships something usable, doesn't depend on the next.

| Phase | Scope | Why first | Effort |
|---|---|---|---|
| **A** | App shell + left nav + Mission Control + design tokens consolidation | Unlocks every other screen; gives the product an identity beyond "one page" | ~1 sprint |
| **B** | Runs rebuild: list/detail split, timeline scrubber, event filters | Biggest single UX upgrade; helps Builder + Auditor | ~1 sprint |
| **C** | Approvals queue + global pending banner + keyboard shortcuts | Operator's primary job; ships safety as a first-class surface | ~3-4 days |
| **D** | Servers fleet page + drill-in | Pulls Health + Reliability out of the run view where they don't belong | ~3-4 days |
| **E** | Policy editor with dry-run | The "wow" feature that makes Watchtower's safety story compelling | ~1 sprint |
| **F** | Settings page + light mode + a11y pass + mobile breakpoints | Polish; needed before any external-facing demo | ~1 sprint |

---

## 11. Open questions to validate before building

Three things worth a quick call before locking the design:

1. **Multi-tenancy?** — Are we ever showing runs from multiple users/teams in one UI? That changes the nav (need a workspace switcher) and Approvals (need ownership filters).
2. **Wall-display mode?** — Should Mission Control have a TV-friendly fullscreen variant (giant metrics, no nav, auto-rotate)? Cheap to add if planned, expensive if retrofitted.
3. **Will builders want to define custom event types?** — If yes, the Inspector and Timeline need to be schema-driven, not hardcoded to known types.
