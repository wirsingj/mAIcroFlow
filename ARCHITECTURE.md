---
yaiml: 0.2
role: architecture
title: Architecture
purpose: Durable system shape, boundaries, invariants, and design constraints for mAIcroFlow.
belongs-here: components, data flow, architectural boundaries, invariants, implemented/intended architecture, known violations, danger zones, retired approaches.
not-here: volatile priorities, command reference, complete history, implementation minutiae better kept near code.
durability: stable; update when system shape or boundaries change.
budget: About 1800 words; a working target, not a length to fill.
read-with: SOT; Maintainer Guide; AI_WORKFLOW_CONTRACT.md; SAFETY.md.
update-when: components, data flow, boundaries, invariants, or major design decisions change.
last-verified: not established; claims not rechecked in this refresh.
agent-guidance: Preserve existing architecture knowledge. Mark implementation divergence. Do not invent legal/security conclusions.
---

# Architecture

## Product Boundary

mAIcroFlow is a local-first, user-directed macro/RPA tool for screen-aware automation. Users explicitly build workflows from typed nodes. AI improves detection and extraction inside those nodes, but it does not invent workflows, plan actions, or control the computer.

mAIcroFlow is not an autonomous agent, hidden prompt orchestrator, generalized DAG engine, workflow marketplace, target-app intrusion tool, or evasion system.

The durable technical posture is: visible pixels in, explicit workflow actions out. The app should use normal OS capture and automation APIs only. It must not read process memory, inspect network packets, hook target apps, inject code, use hidden drivers, bypass protections, or hide automation from the user.

The workflow graph is the source of truth:

```text
Trigger condition(s) -> Capture -> AI Analysis -> Validation -> Human Review when needed -> Action(s)
```

Every run should make it clear why it triggered, what image was captured, what was extracted, what validation decided, and what output was written.

## Layers

- React renderer: visual workflow builder, settings, logs, review UI.
- Electron main process: local desktop bridge for hotkeys, screenshots, files, timers, logs, safety pause, and IPC.
- Go core: small durable local core for deterministic validation/extraction helpers and CSV actions.

The app does not use a database. User data lives under `data/` and user-selected output paths.

Task bubbles can own local reference screenshots. Pasted or imported images are normalized to PNG under `data/examples/<workflow>/<node>/` and assigned stable labels such as `#ref1` and `#ref2`. Node prompts can refer to those labels, keeping examples close to the exact trigger or extraction step they support.

Workflow capabilities are inferred from nodes. A workflow that uses watch detection or vision extraction declares a local vision requirement; spreadsheet actions declare local file output; clipboard actions declare OS clipboard output; future voice nodes can declare voice output. The UI should turn those requirements into a guided setup checklist with explicit user action buttons. Dependencies must never install silently.

## Node Categories

Keep v0 nodes small and composable:

- Triggers: manual hotkey, watch loop, reference image match, region-visible match, model-interpreted screen state.
- Capture: screenshot capture.
- AI Analysis: detect screen type, extract structured fields, classify a result.
- Validation: required fields, numeric validation, confidence threshold.
- Human Review: confirm or edit extracted values when validation or policy requires it.
- Actions: append row, update stats block, write JSON/log, show popup, copy to clipboard, pause or stop workflow.

Do not add scripting/plugin nodes yet. Guarded scripts and keyboard/mouse output are later work and must stay explicit, visible, and policy-gated.

## Trigger Logic

The product should support random stat-gathering macros without becoming an opaque agent. The planned trigger model is an inspectable boolean expression:

```json
{
  "op": "any",
  "conditions": [
    { "kind": "hotkey", "summary": "F7 pressed" },
    {
      "op": "all",
      "conditions": [
        { "kind": "reference-image", "summary": "Score screen is visible" },
        { "kind": "screen-detection", "summary": "Local model says the requested stat panel is present" }
      ]
    }
  ]
}
```

Supported operators should stay simple at first: `all` and `any`. Each leaf condition is an explicit trigger node/configuration. A model prompt can interpret whether a visible screen state matches, but it should only return a structured yes/no or extracted values for that node. It should not decide which workflow or action runs.

Examples this should eventually cover:

- `F7` -> scan visible numbers -> show a small sum popup.
- Configured hotkey or matching result screen -> extract stats -> append spreadsheet row.
- `hotkey sequence X, X, R` and target screen visible -> press `T`, capture, and write selected values to `score.txt`.

## Workflow Diagnostics

Workflows should be linted before arming or saving. Diagnostics are not a replacement for runtime errors, but they catch obvious invalid or unreasonable configurations early:

- invalid hotkeys or malformed trigger conditions
- impossible comparisons such as `1 > 2`
- sensitive or questionable target wording that deserves user review
- extraction prompts that ask the model to click, type, run, write, or otherwise perform actions
- unsupported capture modes or missing monitor selections
- output paths that are missing, malformed, or likely protected by OS permissions
- high-risk action settings such as automatic keyboard/mouse output

The linter should be conservative and transparent. It should block structural errors, warn on contextual risk, and avoid pretending it can determine whether every workflow is permitted in every third-party app.

## Capture Model

Capture is screen awareness, not program intrusion. The app samples visible pixels through normal OS screenshot/window-capture APIs and does not read process memory, inspect packets, hook rendering, inject code, use hidden drivers, or communicate with the target app.

The main window and floating control window request OS-level capture exclusion with Electron content protection. On supported Windows versions this uses the normal display-affinity path so mAIcroFlow controls are not included in screen captures. This is a transparency/privacy feature for the user's own macro panel, not an evasion feature.

Implemented capture sources:

- Display under cursor.
- Primary display.
- Specific monitor.
- Rectangle crop within the selected display source.

Planned capture sources:

- Specific app/window.
- Region within a selected source.

Capture source is part of the workflow graph so the user can inspect and change what is sampled.

Rectangle capture is also node config: explicit `x`, `y`, `width`, and `height` screen coordinates. The builder, reference capture panel, and floating control can open a drag overlay that saves the selected rectangle into the Screen Grab node while keeping the control itself out of captured images where the OS supports capture exclusion.

Unsupported capture sources fail closed. A workflow-driven capture should error rather than silently sampling a different monitor/window, because the user must be able to trust what the workflow is observing.

Live intention capture is implemented as a normal workflow-draft constructor, not as a second runner. The user approves the capability prompts, drag-selects a rectangle, and the app creates a paused `region-visible -> capture region -> AI extract proposal -> validate -> review -> clipboard` workflow. The AI proposal lives in structured extraction fields until the user edits and approves it.

## Visual Trigger Direction

The strongest trigger direction is reference-image-based matching:

- The user provides an example screenshot of the target screen.
- The user can optionally highlight a smaller UI region.
- The workflow watches for that visual condition while armed.
- A conservative deterministic PNG similarity check can fire clear pixel-level matches.
- Local AI performs semantic visual matching fallback, not workflow planning.

Initial matching supports configurable confidence/similarity thresholds, debug reasons, loaded/missing reference metadata, deterministic scores, cooldown, and duplicate hash checks. This is better than relying only on OCR, raw pixels, or natural-language descriptions.

## Watch Mode

Watch mode is lightweight periodic sampling, not continuous surveillance.

Requirements:

- Opt-in per workflow.
- Explicit interval.
- Local-only vision endpoint.
- Temporary screenshots in an OS temp folder.
- Immediate deletion of non-trigger samples.
- No persistent recording.
- No upload.
- No overlapping detection calls.

If a sample matches, it is passed into extraction so detection and extraction analyze the same visible pixels, then deleted. v0 does not retain run screenshots by default.

## AI Boundary

Prompts are generated per node type:

- Reference-image trigger node: strict JSON match prompt.
- Detection node: strict JSON screen-type prompt.
- Extraction node: strict JSON field extraction prompt.
- Classification node: strict JSON classification prompt.

AI output is interpretation only. Workflow logic, ordering, validation, cooldowns, and actions are controlled by the graph and deterministic runner code.

Live intention capture may ask AI to infer a repeatable pattern and a suggested action from visible pixels, but that output is proposal data. It must not mutate workflow actions or execute input without a reviewed workflow change.

## Permission Model

Capability prompts are explicit in the renderer for live capture and setup flows. Current capabilities are screen-region capture, screen observation, local AI analysis, proposed actions, browser prompt, and command help. The UI supports approve once, approve for this renderer session, approve always, deny, and revoking persistent approvals from Settings.

Browser prompt is implemented only for explicit setup links. Command help is a future permission shape with no execution path. The current permission model is not yet a main-process capability-token system, so future hardening should enforce the same contract at IPC boundaries.

## Keyboard And Mouse Output

Keyboard/mouse output can be a legitimate local macro action, but it is high risk compared with writing a file or showing a popup. It should be introduced only as a visible action node with:

- exact key/button sequence shown in the workflow
- target context shown when available
- explicit enablement per workflow
- no stealth hooks or target-app instrumentation
- no competitive-play, online-economy, or terms-bypass positioning
- policy blocks for auto-running unsafe sequences
- logs for every emitted input action

## Structured Observation

Extraction nodes should converge on a generic observation contract. Fishing, receipts, number lists, and score screens should all become observations with fields, confidence, source metadata, warnings, and validation trace.

```json
{
  "observationId": "obs-run-123",
  "schemaId": "macro.structured.v0",
  "source": {
    "kind": "capture",
    "captureId": "capture-123",
    "retained": false
  },
  "confidence": 0.91,
  "fields": {
    "fish_name": { "value": "Blue Rockfish", "confidence": 0.94 },
    "exp_gained": { "value": 293, "raw": "293" },
    "weight": { "value": "236g" },
    "payout": { "value": null }
  },
  "warnings": []
}
```

Rules:

- Strict JSON only.
- `null` for missing values.
- Confidence required.
- Raw values preserved where useful.
- Validation before action execution.

The runner now writes generic structured fields to outputs and attaches a `StructuredObservation` trace. The flat fishing-shaped fields still exist as a legacy/demo adapter for tests and older data, but they should not drive new macro behavior.

## Run Trace

Each run should become inspectable without reading logs by hand:

- trigger source and timestamp
- capture source and retention status
- observation fields, confidence, matched references, and warnings
- validation result
- action status and output target

The trace is currently attached to run previews and logged in pieces. A dedicated run inspector panel is the next UI surface.

## Output Rendering

Output is split into two responsibilities:

- Raw append table: records each approved/validated run.
- Summary/dashboard renderer: derives metrics from raw rows.
- Clipboard renderer: copies reviewed structured fields as plain text without creating a file.

CSV output stays simple and deterministic. Summary blocks are computed by code and must not contain workflow prompt text or natural-language instructions.

Future XLSX output should be a renderer:

- anchored raw table
- pinned summary area
- formatting
- formulas
- charts later

Spreadsheet generation should not be AI-authored layout prose.

## Current Boundaries

- Workflow definition/config: `src/shared/types.ts`, `src/shared/workflowSchema.ts`, `data/workflows.json`.
- Workflow runner/state machine: `src/main/services/workflowRunner.ts`, `src/main/services/runnerState.ts`.
- Trigger/watch scheduler: `src/main/services/watchScheduler.ts`, `src/main/services/watchMode.ts`.
- Capture service: `src/main/services/capture.ts`.
- Local AI provider: `src/main/services/ollama.ts`.
- Validation: `src/main/services/validation.ts`.
- Workflow handler boundary: `src/main/services/workflowHandlers.ts`.
- Action/output renderer: `src/main/services/actions.ts`.
- Safety policy: `src/main/services/workflowPolicy.ts`.
- Diagnostics/logging: `src/main/services/logger.ts`.
- Electron shell, IPC, and hotkey wiring: `src/main/main.ts`.

`src/main/main.ts` should stay thin. It wires Electron APIs to the runner and scheduler, but workflow execution belongs in services.

## Runner State

Runtime states:

- `inactive`: paused or disabled.
- `armed`: ready for a trigger.
- `running`: capture/extract/validate/action is in progress.
- `needs_review`: a run is waiting for user correction or policy approval.
- `failed`: the last run failed and needs attention.

Allowed transitions:

```text
inactive -> armed
armed -> running | inactive | failed
running -> armed | needs_review | failed
needs_review -> armed | failed
failed -> armed | inactive
```

Overlapping triggers are ignored while a workflow is running or awaiting review.

## Packaging Notes

Development uses `go run ./cmd/maicroflow-core` from Electron. Before sharing packaged builds, compile the Go core as a sidecar binary and update the Electron bridge to prefer the packaged binary path.
