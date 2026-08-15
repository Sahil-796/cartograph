# Cartograph — Build Docs

Per-phase engineering records for the Cartograph take-home. Each file documents **what was
built, why, how to run it, and how it was verified** for one phase of the plan in
[`../plan.html`](../plan.html).

The plan is the design; these docs are the build log. Where the plan's body text and the
"Revisions — grilling session" callout at the top of `plan.html` disagree, the **callout
wins** (it captures decisions sharpened after the plan was first written).

## Phases

| Phase | Title | Status | Doc |
|-------|-------|--------|-----|
| 1 | Foundation | In progress | [phase-1.md](phase-1.md) |
| 2 | Extraction | Not started | — |
| 3 | Graph layer | Not started | — |
| 4 | Web application (ship line) | Not started | — |
| 5 | AI surfaces | Not started | — |
| 6 | Live ingestion | Not started | — |

## Stack (authoritative)

Node 20 · pnpm workspaces · TypeScript (ESM) · React + Vite · NestJS · CognoDB (openCypher /
Bolt 5.0–5.4) · BullMQ + Redis · Anthropic SDK.
</content>
