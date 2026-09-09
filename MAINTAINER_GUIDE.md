---
yaiml: 0.2
role: maintainer
title: Maintainer Guide
purpose: Operating knowledge for setup, checks, diagnostics, and safe maintenance.
belongs-here: commands, setup notes, test strategy, important files, danger zones, failure playbooks, environment-dependent procedures.
not-here: product direction, durable architecture narrative, complete release history.
durability: moderately stable; update when commands, workflows, or maintenance hazards change.
read-with: SOT; Architecture; README.md; MANUAL_TEST_CHECKLIST.md.
update-when: setup, commands, test scope, diagnostics, or recurring failure modes change.
agent-guidance: Prefer verified commands. Do not invent environment guarantees. Preserve WIP. Keep procedures practical.
---

# Maintainer Guide

## Setup

Prerequisites inferred from the repo:

- Node/npm for the Electron + React/TypeScript app.
- Go for `cmd/maicroflow-core` and `internal/core` tests.
- Optional local Ollama for vision extraction/detection.

Basic local setup:

```powershell
npm install
npm run dev
```

## Verified Commands

From `package.json`:

```powershell
npm run test
npm run test:go
npm run build
npm run validate
```

`npm run validate` expands to Vitest, Go tests, and TypeScript/Electron production build.

Focused checks used by recent work:

```powershell
npm test -- --run tests/watchMode.test.ts tests/referenceMatcher.test.ts
npm test -- --run tests/workflowLint.test.ts tests/workflowReadiness.test.ts
npm test -- --run tests/extractor.test.ts tests/workflowPolicy.test.ts tests/actionsSummary.test.ts
```

## Important Files

- `AGENTS.md`: persistent repository instructions that tell Codex to load and maintain YAIML during ordinary work.
- `SOT.md`: concise YAIML current state.
- `SOTM.md`: older/current detailed state snapshot; preserve useful content and reconcile when SOT changes.
- `ARCHITECTURE.md`: durable boundaries and system shape.
- `AI_WORKFLOW_CONTRACT.md`: AI/provider contract.
- `AI_USAGE.md`: AI-assisted development disclosure and generated-output provenance expectations.
- `SAFETY.md`: product safety posture.
- `MANUAL_TEST_CHECKLIST.md`: human app verification.
- `src/main/main.ts`: Electron IPC/window/hotkey wiring; should stay thin.
- `src/main/services/workflowRunner.ts`: workflow run state machine.
- `src/main/services/watchScheduler.ts` and `watchMode.ts`: watch-loop scheduling/lifecycle.
- `src/main/services/ollama.ts`: local AI integration and visual trigger detection.
- `src/main/services/referenceMatcher.ts`: deterministic PNG reference matching.
- `src/main/services/capture.ts` and `captureConfig.ts`: screen capture behavior.
- `src/shared/types.ts`, `workflowSchema.ts`, `workflowReadiness.ts`, `workflowLint.ts`: workflow contracts, migration, readiness, and diagnostics.
- `tests/`: Vitest coverage for workflow contracts, watch mode, actions, safety language, hotkeys, reference matching, and schema.

## Danger Zones

- The worktree may be entirely untracked or dirty. Treat this as intentional WIP unless the human says otherwise.
- Do not reset, discard, rename, or delete existing files to make room for YAIML or refactors.
- Do not silently broaden app behavior into autonomous agent behavior.
- Do not retain screenshots by default or add hidden target-app introspection.
- Do not make dependency-major upgrades casually; current audit leftovers require a deliberate upgrade pass.
- Do not remove legacy fishing fields without planning compatibility and tests.
- Be careful editing embedded HTML in `src/main/main.ts` for the rectangle picker; build after changes.

## Diagnostics And Failure Playbooks

- Watch behavior: inspect Run Inspector and logs for `sample_created`, baseline decisions, duplicate skips, `detection_match`/`detection_no_match`, reference metadata, and sample deletion events.
- Ollama unavailable: workflow falls back to deterministic/manual extraction paths; generic workflows may produce empty structured fields with editable review.
- XLSX locked/open in Excel: workbook write errors should surface a close-Excel-or-switch-to-CSV recovery message.
- Region-visible trigger not arming: confirm the Screen Grab node uses `mode: region` with valid x/y/width/height.
- Reference-image trigger weak match: confirm refs are present, loaded, normalized PNG when possible, and the pixel match threshold is reasonable.
- Hotkey not firing: check logs for registration warnings and confirm workflow status is active/armed.

## Manual Verification

Use `MANUAL_TEST_CHECKLIST.md` for app-level behavior. Especially verify:

- floating control workflow selection and region save target;
- region picker coordinates and crop behavior;
- Run Inspector watch-decision row;
- deterministic reference scores when trigger screenshots are attached;
- no persistent run screenshot is left behind by normal runs.

## Maintenance Notes

- Keep new code paths generic unless intentionally touching legacy/demo fishing adapters.
- When a workflow shape changes, update `workflowSchema.ts` migrations rather than adding more ad hoc normalization.
- Update YAIML after meaningful changes: concise SOT first, architecture only for durable shape, maintainer guide only for operating knowledge.
- Phrases such as "update YAIML", "updated YAIML", "check new YAIML", or "run a YAIML update" mean to compare this repository's local YAIML scaffolding against a human-provided, workspace-provided, or team-approved YAIML reference, refresh only compatible prompts/templates/guidance/agent-instruction pointers, and preserve project-specific memory.
- Phrases such as "clean up YAIML", "compress YAIML", "compact project memory", "prune project memory", or "prune SoT" mean to remove stale or repetitive memory while preserving current truth, evidence, human direction, unresolved conflicts, and useful uncertainty.
- Keep machine-specific YAIML reference paths out of committed files. Record exact reference revisions in task reports, not in versioned memory, unless the human explicitly asks for a stable public/team reference pointer.

## YAIML Maintenance

Provide the YAIML reference from the human prompt, workspace context, or a team-approved source at run time. Do not commit machine-specific reference paths, local drive names, user profile paths, `file://` URIs, localhost URLs, private workspace URLs, secrets, private transcripts, or raw sensitive logs into versioned project memory.

Phrases such as "update YAIML", "updated YAIML", "check new YAIML", "refresh YAIML", or "run a YAIML update" mean convention refresh, not an ordinary project-memory rewrite. For this repository, compare local YAIML scaffolding against the provided reference and update only compatible prompts, templates, discovery hints, agent-instruction pointers, or YAIML-maintenance guidance. Preserve project memory and the existing discovery layout unless a human explicitly authorizes a layout migration.

Phrases such as "clean up YAIML", "compress YAIML", "compact project memory", "prune project memory", or "prune SoT" mean to remove stale or repetitive memory while preserving current truth, evidence, human direction, decisions, unresolved conflicts, and uncertainty. Do not pad documents to meet budgets or delete necessary governed knowledge just to reduce word count.

This repository does not need local YAIML prompt or template copies unless it already keeps them for a concrete workflow. Do not add `prompts/` or `templates/` just because the reference has them. Preserve project-specific SoT, Architecture, Maintainer Guide, risks, commands, naming, and supporting documents unless the reference changes how future agents should maintain YAIML here.
