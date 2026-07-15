# The State of the MaAicro (SotM)

This document is the current alignment snapshot for mAIcroFlow. Keep SotM short and update it when a milestone changes the product shape.

## Product Doctrine

mAIcroFlow is next-generation macro software: classic macro recording and replay, upgraded with AI-assisted intent inference and visible screen awareness.

The base safety layer is simple:

```text
mAIcroFlow can do what the user's eyes and fingers can do.
```

It may observe visible pixels, record explicit user actions, and replay approved mouse, keyboard, clipboard, window, app-launch, and local-file steps. It must not inspect process memory, inject code, read packets, install hidden hooks or drivers, bypass anti-cheat or DRM, evade access controls, or depend on hidden target-app state.

The second layer is policy:

```text
Even eyes-and-fingers automation should not be used for workflows that generally break ToS, fair-use, or platform safety boundaries.
```

mAIcroFlow should be comfortable automating personal routines such as opening morning apps, navigating daily pages, collecting normal information, or replaying repetitive visible single-user tasks. It should reject or strongly gate workflows aimed at competitive advantage, prohibited unattended farming, anti-bot evasion, spam, fake engagement, abuse, credential capture, payments, account/security changes, or anything that depends on hiding automation from the target app.

The short version:

```text
Eyes and fingers, not memory and wires. Approved routines, not covert bots.
```

## Current Architecture

mAIcroFlow is an Electron + React desktop app with a small Go helper core. Electron owns the Windows desktop bridge: global hotkeys, display capture, floating windows, local files, timers, and IPC. React owns the workflow builder, AI setup, logs, and review UI. Go currently covers deterministic helper behavior and tests, but the production runner lives in TypeScript services.

The runtime shape is:

```text
workflow JSON -> trigger/watch scheduler -> capture service -> extraction service -> validation -> action/output renderer -> logs/state
```

Watch detection now logs a structured debug payload with match state, confidence, matched reference names, sample mode/dimensions, optional capture region, and the model's reason. The Run Inspector displays watch decisions, detection confidence/reason, and capture region details so watch-mode behavior is inspectable without opening raw logs.

Reference-image watch logs now include configured, successfully loaded, and missing trigger reference screenshots. This makes stale paths or non-imported examples visible in the Run Inspector.

Reference-image triggers now run a conservative deterministic PNG similarity precheck before calling Ollama. Strong pixel-level matches can fire without the model; weaker or semantic matches still fall through to local vision with deterministic scores logged and summarized in the Run Inspector. Newly imported or pasted references are normalized to PNG. Older JPEG/WEBP refs still load for Ollama but are marked as unsupported for the deterministic PNG precheck until reimported.

Visual trigger nodes expose both model confidence minimum and PNG pixel-match minimum, with linting for invalid threshold values.

`StructuredObservation.source` now carries the capture region too, so extraction/run payloads can preserve the rectangle that produced a field set even after the temporary screenshot is deleted.

`screen-detection`, `reference-image`, and `region-visible` now share the watch scheduler path. `reference-image` requires a trigger reference screenshot, and `region-visible` requires a rectangle-backed Screen Grab node before it can arm.

Visual trigger nodes can set an optional confidence minimum. The scheduler turns below-threshold model matches into logged no-matches instead of firing the workflow.

Rectangle capture can now be picked with a drag overlay from the builder, reference capture panel, or floating control. The picked rectangle is saved into the Screen Grab node as a specific display plus absolute screen coordinates, and watch detection uses that same rectangle. The overlay shows live width/height and screen coordinates while dragging.

New Live Flow is now a focused live-intention capture path. It asks for explicit permissions, opens the same rectangle picker, creates a paused workflow draft for the selected region, and uses local AI extraction fields to propose visible state, repeatable pattern, guard condition, and suggested action. The suggestion is reviewed in a dedicated proposed-workflow surface with a node-level diff; it can be applied back into workflow summaries/prompts while staying paused and is not executed automatically.

The workflow node taxonomy is:

- Trigger: starts a workflow from a hotkey or watch condition.
- Observe: captures visible pixels through normal OS APIs.
- Think: uses deterministic parsing or local AI to interpret visible context.
- Guard: validates or requests review before output.
- Act: writes explicit configured outputs, including file append and reviewed clipboard copy.

The app should open as a fresh builder. New Macro starts with one trigger bubble, then the user adds capture, extract, guard/review, and action bubbles as needed. The Screen-to-CSV starter path is a first use case, not the product architecture. Fishing is one real-world test case for that starter path, not the app's architecture.

The builder now intentionally leans toward a simple blueprint-style canvas: a horizontal bubble flow with node ports, visible progress, and advanced details hidden until requested. The goal is "build a macro by adding bubbles," not "fill out a framework form."

The current AI/provider contract is captured in [AI_WORKFLOW_CONTRACT.md](AI_WORKFLOW_CONTRACT.md). Provider integrations should exchange structured workflow context and structured run results; they should not become hidden agents or required dependencies.

## Unresolved Technical Debt

- `ExtractionResult` still carries legacy fishing-shaped fields for compatibility, but runner observations and default output rows now use generic structured fields. Legacy fishing field detection is centralized so new generic paths do not need to know the field list.
- Watch detection now uses a generic workflow trigger detection prompt, surfaces confidence/reason/reference-load debug in logs and the Run Inspector, and can arm reference-image/region-visible trigger kinds through the current watch path. A conservative deterministic reference-image precheck exists; richer region/object matching and thresholds still need product polish.
- Global workflow hotkey registration is now dynamic for active workflows. The global safety pause remains fixed at `Ctrl+Alt+Shift+P`; richer conflict UX is still needed.
- Rectangle capture supports explicit numeric config and drag-to-select from the builder/floating control, with live size/coordinate feedback. It still needs richer display-edge guidance.
- XLSX writing now reports a clear close-Excel-or-switch-to-CSV recovery message when workbook writes fail due to lock/permission errors. A true live-update strategy for open workbooks is still unresolved.
- Clipboard output now copies generic structured fields as plain text after review. It is intentionally not included in auto-run allowed actions yet.
- Live run progress now flows from the main runner to the renderer, covering queued/capture/extract/validate/review/action/done/failed/ignored stages with output reveal and Run Inspector affordances.
- Capability approval UI now supports approve once, approve for session, approve always, deny, and resetting persistent approvals from Settings. The current implementation gates renderer-driven live flow/capture/run/setup paths; backend-enforced capability tokens remain future work.
- `npm audit fix` has applied safe dependency updates. Remaining audit findings currently require major Electron/Vite/Vitest upgrades or an ExcelJS strategy for its transitive `uuid` issue, so they should be handled as an explicit dependency-upgrade pass.
- Go is present but not yet the main durable backend boundary.
- Workflow JSON now carries `schemaVersion: 1` for new/validated saves, and legacy missing-version workflows migrate through a v0-to-v1 migration registry.

## Current Assumptions

- Windows is the primary target for v0.
- Local Ollama is the first AI provider and only local endpoints are allowed.
- The user prefers low-friction macro behavior after explicit setup: trusted low-risk workflows should run without confirmation, while validation failures and high-risk actions stop.
- Screenshots are processing artifacts and should not be retained by default.
- Node-pasted images are durable examples owned by a workflow node.
- Capture-excluded UI is a user-facing privacy/usability feature, not a stealth feature.

## Possible Product/Implementation Divergence

- The UI can add typed nodes, but execution still expects a mostly linear v0 chain.
- Product language says generic macro/RPA, and the default validation/action path now follows generic fields. Remaining fishing code should stay quarantined as demo/legacy adapter code.
- PNG reference images are checked with deterministic similarity first, then all supported image refs are sent to Ollama for semantic fallback. New refs are normalized to PNG, but older stored non-PNG refs may need reimporting for deterministic matching. Better visual diff/debug output is still pending.
- The app promises guided setup, but model choice is still a light Ollama helper rather than a full dependency planner.
- The floating control can now select a workflow, run it, and grab a rectangle into that workflow's Screen Grab node. Richer status controls are still thin.
- The simplified builder reduces first-run confusion, but automated coverage still does not exercise the actual Electron renderer as a user would. Add a UI smoke test before treating the happy path as truly protected.
- Live intention capture produces a useful draft, dedicated proposal review, node-level apply diff, and apply-to-draft path. It still does not create executable action sequences.

## Stacked Steering Prompts

The active direction combines several overlapping asks:

- Fresh Screen-to-CSV builder flow: the first-run product experience.
- Fishing logger loop: a proving workflow, but user-created from the starter flow.
- Broad AI-assisted macro/RPA builder: the product direction.
- Safety/TOS posture: visible pixels in, explicit workflow actions out.
- Seamless background utility: floating control, no focus stealing, active workflows stay armed.
- No retained screenshots: samples and run captures are temporary.
- Node-local example images: task bubbles own `#ref1`, `#ref2`, etc.
- Cuddler/OllamaSaddle-friendly boundary: adapters may prepare context or normalize providers later, while mAIcroFlow remains a useful local workflow runner on its own.

Partial overlaps to watch:

- "Review by default" versus "macro just works": current rule is auto-run for trusted low-risk file/spreadsheet workflows, review for validation failure, high-risk actions, and clipboard output.
- "No hidden behavior" versus "do not include app in screenshots": capture exclusion is allowed only because it is visible to the user and protects the user's own workflow capture from UI contamination.
- "Broad macro tool" versus "do not overbuild": add only the next node capability needed by the vertical slice.

## Overengineering Risk

- Building a generalized DAG engine before the linear workflow loop is reliable.
- Adding plugins, marketplace, cloud orchestration, or natural-language workflow planning too early.
- Abstracting actions and extractors so far that the demo loop gets worse.
- Treating AI as an agent instead of a node implementation detail.
- Adding Cuddler or OllamaSaddle dependencies before the workflow contract needs them.

## Underengineering Risk

- Accidentally using legacy fishing adapters from new macro code.
- Letting the v0-to-v1 migration registry stagnate; future workflow shape changes should add explicit migrations there instead of more inline normalization.
- Leaving output writes vulnerable to file locks without a user-readable recovery path.
- Relying on prompts without structured node schemas and validation.
- Shipping watch mode without debug visibility into why detection matched or skipped.

## Next Smallest Coherent Milestone

Build the "live intention confidence + watch/debug hardening" slice:

1. Manually exercise New Live Flow end to end with a non-fishing target and Ollama running.
2. Manually test whether the live proposal review surface is understandable with real Ollama output.
3. Keep improving the Run Inspector so a user can understand a watch decision without opening raw logs.
4. Add better region-picker failure/display-edge states and keep the floating control useful for multi-workflow setups.
6. Keep deterministic reference matching conservative, visible, and configurable; add visual diff/debug output before broadening matching behavior.
7. Preserve the generic `StructuredObservation` path and keep fishing code quarantined as a legacy/demo adapter.
8. Treat the remaining audit findings as a deliberate dependency-upgrade pass, not incidental churn.
9. Keep validating with `npm run validate` after each meaningful slice.

This is the smallest milestone that turns the new region/reference watch path from "works" into something a user can trust and debug.
