# mAIcroFlow

## Mission

mAIcroFlow is a local-first, user-directed macro/RPA tool that helps people build visible automation workflows from normal screen awareness and explicit outputs. It uses AI as one interpretation layer in the macro stack, not as a hidden agent. The app observes only what the user could already see, through normal OS capture APIs, and acts only through transparent, user-configured workflow nodes.

Users define simple flows:

```text
Trigger -> Capture -> AI Analysis -> Validation -> Review if needed -> Action
```

The product is AI-assisted macro/RPA software. It is not botting software, not an autonomous agent, and not a prompt-orchestration platform. The user explicitly builds workflows from typed nodes. AI improves node execution quality, especially visual detection and structured extraction, but the workflow graph controls the logic.

The AI/provider boundary is documented in [AI_WORKFLOW_CONTRACT.md](AI_WORKFLOW_CONTRACT.md). The short version: visible inputs and workflow JSON go in; structured observations, validation state, and explicit action results come out. Ollama is the current local provider path. Cuddler and OllamaSaddle should remain future-friendly adapters, not required runtime dependencies.

The screen-to-CSV starter flow is only a starting point. A workflow might capture a fishing score screen, extract stats, and append them to a tracker. Another might summarize a selected screen region and copy the result to the clipboard. The product shape is the workflow builder and runner, not any single workflow.

In this project, output means transparent, user-approved behavior through normal OS and app surfaces such as clipboard, keyboard/mouse events, local files, scripts, or webhooks. It does not mean process injection, memory access, stealth hooks, anti-cheat evasion, packet inspection, hidden drivers, or covert automation.

mAIcroFlow's screen awareness is intentionally limited to visible pixels available through normal OS capture APIs. The workflow can sample a display, and later a user-selected monitor/window/region, without communicating with or modifying the target program.

That is the intended technical boundary for staying unobtrusive and non-invasive. It avoids memory access, process injection, stealth hooks, anti-cheat evasion, and target-app modification. It is still the user's responsibility to use workflows in ways allowed by the apps and games they run.

The first user flow is intentionally created by the user:

1. Create a new flow.
2. Configure the trigger node: for example, when this screen appears.
3. Configure capture: full screen or a rectangle from the selected monitor/display.
4. Configure extraction fields: for example, `exp`, `weight`, `name`, and `bait_used`.
5. Configure validation and review behavior.
6. Configure output: for example, append a CSV row or copy reviewed fields to the clipboard.
7. Arm the workflow when it is ready.

The live capture flow starts from `New Live Flow`: approve the requested capabilities, drag-select a screen rectangle, then review the paused workflow draft that asks local AI to propose visible state, repeatable pattern, guard condition, and suggested action.

## Stack

This v0 uses Electron + React/TypeScript for the desktop shell and UI, plus a small Go core for backend-style workflow validation, deterministic extraction normalization, and CSV actions.

Electron is used because it gives the app practical access to Windows desktop capabilities today: global shortcuts, screenshots through normal OS APIs, local files, IPC, and a packageable desktop route. Go is included for the durable local core because it is a good fit for small, testable, user-local engines and matches the preferred backend direction.

The app should stay lightweight. Local vision models are optional dependencies managed by the user or an installer flow; they should not be bundled into the base app by default.

## What Works In v0

- Desktop-style UI with Workflows, AI Setup, Captures, and Settings.
- Capture-excluded floating control mode for a small draggable macro panel.
- Fresh-start workflow library with creator-driven New Macro and New Live Flow entry points.
- New Live Flow entry point that asks explicit capability approvals, uses the rectangle picker, and creates a paused live-intention workflow draft.
- Simple visual workflow builder with typed nodes.
- Task bubbles can hold pasted or imported reference screenshots as `#ref1`, `#ref2`, etc.
- Run Now button for the workflow.
- Dynamic workflow hotkey runner through Electron.
- Global safety pause hotkey: `Ctrl+Alt+Shift+P`.
- Workflow runner states: inactive, armed, running, needs_review, failed.
- Workflow checks for invalid hotkeys, impossible trigger logic, action-like prompts, unsafe auto-actions, unsupported capture sources, and suspicious output paths.
- Thin Electron shell with runner and watch scheduling separated into services.
- Per-workflow automatic action for low-risk outputs once explicitly configured.
- Full-screen capture held as a temporary local artifact only long enough for extraction, then deleted.
- Explicit capture source setting: display under cursor, primary display, or a specific monitor.
- Explicit rectangle crop support on capture nodes, including drag-to-select from the builder or floating control.
- Local Ollama vision extraction for captured screenshots, with deterministic fallback if Ollama is unavailable.
- Field validation before writing.
- Review/edit modal when validation fails or policy requires approval.
- Capability approval modal with approve once, approve for session, approve always, deny, and Settings reset for persistent approvals.
- Configurable CSV/XLSX append action, defaulting to a Desktop `output` folder.
- Reviewed clipboard output action for copying generic structured fields without writing a file.
- Deterministic spreadsheet summary metrics from raw rows.
- Local JSON persistence in `data/workflows.json` and `data/settings.json`.
- User-pasted/imported node reference screenshots normalized under `data/examples/` as PNG `#ref1`, `#ref2`, etc. references.
- Local log file at `data/app.log`.
- Ollama status check for `http://localhost:11434`.
- Guided setup assistant that explains what the selected workflow needs and offers explicit install/model actions.
- Node-local extraction prompt and target fields.
- Generic structured extraction/output path; the old fishing-shaped fields remain only as a legacy/demo compatibility adapter.
- Experimental watch mode that samples disposable local screenshots, deletes no-match samples, uses cooldown, duplicate, optional model confidence guards, and configurable PNG reference-image similarity before local vision fallback.
- TypeScript and Go validation tests.

The generic workflow model is node-based:

- Trigger: hotkey now; experimental watch-for-matching-screen, reference-image, and region-visible modes now through the watch path; PNG reference-image triggers get a high-confidence deterministic pixel matcher before local-vision fallback.
- Capture/context: screen, explicit rectangle crop, and drag-to-select regions now; active window, selected text, and app event payload later.
- AI analysis: local Ollama vision now, with deterministic fallback; reference-image matching and structured extraction contracts next.
- Live intention: selected-region draft now; AI proposes interpretation fields for review, but does not modify actions or run input.
- Validate/review: low-risk trusted workflows can run through; failed validation and risky actions stop for review.
- Action/output: configurable CSV/XLSX and reviewed clipboard output now; JSON/log output and richer workbook rendering later.

## Run Locally

```powershell
npm install
npm run dev
```

Run tests:

```powershell
npm run test
npm run test:go
```

Run all validation:

```powershell
npm run validate
```

## Fresh Start Flow

The app starts with an empty workflow library. Click `New Macro` to create a paused creator-driven flow:

- Trigger: watch for a matching visible screen, with the configured hotkey as a testing shortcut when available.
- Add Observe, Think, Guard, and Act bubbles as needed.
- Capture can use the visible display under cursor or an explicit rectangle.
- Extract uses local Ollama vision when configured.
- Validate/review stops when validation or policy requires it.
- Output can append CSV/XLSX or use reviewed clipboard output.

Use the node bubbles to paste reference screenshots as `#ref1`, `#ref2`, define fields, and choose the output folder/file. Resume the workflow only after those pieces are configured.

## Live Intention Flow

`New Live Flow` asks for capability approval, opens the region picker, and creates a paused workflow for the selected rectangle. `Run Test` captures that region and asks local AI for structured proposal fields. The review modal is the approval boundary; suggested actions are proposal data, not executable input. A reviewed proposal shows a node-level diff before it can be applied back into the editable workflow draft as summaries/prompts while the workflow stays paused.

## Background Runner

Active workflows stay armed after each run. A configured workflow can sample for a matching screen every 5 seconds, its configured hotkey can trigger manually when available, and a valid extraction appends the configured output row, logs the run, and returns to armed without focusing the app.

If automatic action is disabled, validation fails, or a high-risk action is configured, the run enters `needs_review` and opens the review/edit flow.

## Watch Mode

Watch mode is opt-in and experimental. While a workflow is armed, mAIcroFlow can periodically capture a temporary local screenshot sample to ask a local vision model whether the target screen is visible. Non-matching samples are deleted immediately. Matching samples are passed into extraction so detection and extraction analyze the same visible pixels, then deleted. v0 does not keep run screenshots by default.

Watch mode never records video or streams the screen. It skips overlapping detection calls, applies a cooldown after matches, and can skip duplicate unchanged screens by hash.

## Output Rendering

CSV output is deliberately simple: raw rows on the left, computed summary metrics to the right. The summary block is generated by deterministic code from the raw rows; natural-language workflow notes are not written into the spreadsheet.

XLSX output is the preferred next renderer for formatting, pinned summary sections, formulas, and charts.

Clipboard output copies reviewed structured fields as plain text. It is review-gated in v0, so selecting it disables automatic output until the user confirms the run.

## Safety And Privacy

See [SAFETY.md](SAFETY.md). The short version: local-first, visible workflows, explicit action policies, review on validation failure or risky actions, visible pixels in, explicit workflow actions out, no process memory access, no target-app hooks, no packet inspection, no code injection, no hidden drivers, and no hidden cloud calls.

Persistent capability approvals can be revoked from Settings. Browser setup links are permission-gated; command-line help is represented as a future permission shape but has no execution path in v0.

## Ollama Setup

The AI Setup screen checks whether Ollama is reachable at `localhost:11434`, lists installed local models, and shows what the selected workflow needs. Setup is guided: users can open the official Ollama download page and explicitly pull the selected model from inside the app. The app does not silently install software, and v0 only permits local Ollama endpoints.

Suggested first local vision model field: `llava:7b` for a quick local test, or a smaller vision model such as `moondream` when size matters more than accuracy. Actual viability depends on machine resources and your installed Ollama models.

## Future Cuddler And OllamaSaddle Plan

Cuddler may eventually orchestrate project context, files, prompts, provider windows, and local tooling.

OllamaSaddle may eventually normalize calls across Ollama and other local/provider systems.

mAIcroFlow should remain useful without either one. The intended integration direction is for future tools to hand mAIcroFlow a structured workflow request and receive a structured run trace/result, not to drive hidden actions with free-form prompts.

## Roadmap

See [ROADMAP.md](ROADMAP.md).

## The State of the MaAicro (SotM)

See [SOTM.md](SOTM.md) for the latest architecture snapshot, unresolved technical debt, assumptions, steering-prompt overlaps, and next smallest milestone.
