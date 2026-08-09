---
yaiml: 0.2
role: sot
title: SOT
purpose: Current engineering state and direction for the project.
belongs-here: goals, current capabilities, declared direction, active risks, priorities, divergence, uncertainty, useful recent lessons.
not-here: durable architecture, command reference, complete history.
durability: volatile; synthesize and prune aggressively.
read-with: Architecture; Maintainer Guide; SOTM.md.
update-when: direction, verified reality, risks, priorities, or useful engineering lessons change.
agent-guidance: Verify implementation claims. Preserve human intent. Mark uncertainty. Surface conflicts. Prune stale detail.
---

# SOT

## Project Identity

mAIcroFlow is a local-first Electron + React/TypeScript desktop app for user-directed, screen-aware macro/RPA workflows. It uses AI as an interpretation layer inside explicit workflow nodes, not as an autonomous agent. Visible pixels and workflow JSON go in; structured observations, validation state, and explicit output actions come out.

Declared boundary: visible pixels in, explicit workflow actions out. The app must not rely on process memory access, target-app hooks, packet inspection, code injection, hidden drivers, anti-cheat/DRM bypass, or hidden automation.

## Verified Current Shape

- Runtime shape is `workflow JSON -> trigger/watch scheduler -> capture -> extraction -> validation/review -> action/output -> logs/state`.
- Electron main owns desktop bridge concerns: global hotkeys, display capture, floating windows, IPC, local files, timers, and watch scheduling.
- React renderer owns workflow builder, AI setup, run inspector, review UI, captures/logs, and settings.
- Go core exists for deterministic helper behavior/tests, but the production workflow runner is TypeScript.
- Local Ollama is the current AI provider path; only local endpoints are intended for v0.
- Workflow data and settings are local JSON files under `data/`.
- New/pasted reference screenshots are normalized under `data/examples/` as PNG refs such as `#ref1`.

## Current Capabilities

- Fresh workflow builder with typed trigger, capture, extract, validate/review, and action nodes.
- The default New Macro starts as a creator-driven single trigger bubble; users add capture/extract/output bubbles instead of receiving a fully configured fake demo.
- New Live Flow creates a paused live-intention draft after explicit permission prompts, drag-selecting a region, and storing that rectangle in a normal workflow graph.
- Live-intention drafts use local AI to propose `visible_state`, `repeatable_pattern`, `guard_condition`, and `suggested_action` fields; these are editable proposal fields, not executed actions.
- Live-intention review now renders those fields as a proposed workflow review surface with an explicit "AI interpretation, not an action" notice.
- Reviewed live-intention proposals can be applied back into the editable workflow draft as summaries/prompts/metadata while keeping the workflow paused and `autoAppend` disabled.
- The live proposal review shows a node-level diff before applying, including title, summary, prompt, and proposal metadata changes.
- Permission UI supports approve once, approve for this renderer session, approve always, deny, and Settings reset for persistent capability approvals.
- The builder uses a simplified blueprint-style bubble canvas by default, with detailed node configuration behind a Details toggle.
- Runs emit live progress stages to the renderer so users can see capture, extraction, validation/review, action, done, failed, or ignored state without reading logs first.
- Dynamic workflow hotkeys for active workflows plus global safety pause `Ctrl+Alt+Shift+P`; malformed chords and duplicate modifier aliases are blocked by lint/skipped before registration.
- Watch mode for `screen-detection`, `reference-image`, and `region-visible` trigger kinds.
- Capture sources include display under cursor, primary display, specific monitor, and rectangle crop.
- Drag-to-select rectangle picker is available from builder/reference capture/floating control; floating control can choose a workflow and save a rectangle into that workflow.
- Region selection chooses monitor ownership by region center and falls back to largest display overlap for monitor-edge/gap selections.
- Watch debug logs and Run Inspector show watch decisions, detection confidence/reason, capture region, reference-load metadata, and deterministic reference scores.
- Reference-image triggers use a conservative deterministic PNG similarity precheck before Ollama semantic fallback.
- `StructuredObservation` is the primary run/debug payload; legacy fishing-shaped fields remain for compatibility/demo adapter paths.
- CSV/XLSX append actions exist, with clearer workbook-lock recovery messaging.
- Clipboard output is implemented as an explicit reviewed action that copies generic structured fields to the system clipboard; it is not allowed to auto-run under the current safety policy.

## Validation State

Reported by the August 8, 2026 ShepAIrd YAIML/TODO audit pass:

- `npm run validate` passed.
- Vitest passed with 16 files and 107 tests.
- Go tests passed as part of validation, and a separate `go test ./...` pass also passed.
- TypeScript/Electron production build passed.
- `npm audit --audit-level=moderate` was not rerun in this pass. Existing findings remain a deliberate dependency-upgrade task around Electron/Vite/Vitest/electron-vite and ExcelJS/uuid.

## Declared Human Direction

- Keep the product generic: a screen-aware macro/RPA builder, not a fishing-specific app.
- Keep fishing as a proving/test workflow only.
- Prefer low-friction macro behavior after explicit setup: trusted low-risk workflows can auto-run; validation failures and high-risk actions stop for review.
- Keep screenshots as temporary processing artifacts by default.
- Keep Cuddler/OllamaSaddle future-friendly as adapters, not required runtime dependencies.
- Continue using SOTM/SOT-style project memory to preserve engineering understanding across disposable agent sessions.

## Active Risks And Divergence

- `ExtractionResult` still has legacy fishing-shaped fields. The field-list check is centralized, but the type remains compatibility debt.
- The UI can add typed nodes, but execution is still effectively a linear v0 chain.
- Action/replay remains underdeveloped beyond file append and reviewed clipboard output; keyboard/mouse output is still intentionally not implemented.
- Permission gating is implemented in the renderer UX for live flow, capture, run, and setup-link paths; it is not yet a backend-enforced capability token system.
- Deterministic reference matching is intentionally conservative and PNG-focused; richer visual diff/debug and broader image handling remain open.
- Floating control is useful for run/region targeting but still has thin status controls.
- `npm audit fix` applied safe updates earlier. Current audit findings still require a deliberate Electron/Vite/Vitest/electron-vite major-upgrade pass or an ExcelJS/uuid strategy.
- Go is not yet the durable backend boundary for the production runner.
- There is still no automated UI smoke test that proves the first-run builder flow works visually end-to-end; current confidence comes from unit tests, production build, and the manual checklist.

## Current Priority

Build the "generic macro confidence + watch/debug hardening" slice:

1. Manually exercise New Live Flow end to end with a non-fishing target and Ollama running.
2. Manually test whether the live proposal review surface is understandable with real Ollama output.
3. Improve Run Inspector clarity so watch decisions are understandable without raw logs.
4. Improve region-picker edge/failure states.
5. Keep deterministic reference matching conservative, visible, and configurable.
6. Preserve the generic `StructuredObservation` path and keep fishing quarantined.
7. Treat dependency/security upgrades as an explicit pass, not incidental churn.
8. Run `npm run validate` after meaningful slices.

## Open Questions

- How far should deterministic matching go before it needs real visual diff UI?
- When should the Go core become a production boundary instead of a helper/test path?
- What is the safest upgrade path for Electron/Vite/Vitest and the ExcelJS transitive `uuid` audit finding?
- What is the first non-fishing macro example that proves generic extraction/action ergonomics beyond spreadsheets?
