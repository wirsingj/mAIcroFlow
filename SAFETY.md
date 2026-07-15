# Safety Model

mAIcroFlow is a user-controlled local visual workflow runner. It should remain transparent, pausable, inspectable, and repeatable.

## Mission Boundary

mAIcroFlow observes user-visible screen pixels through normal OS screenshot/window capture APIs, interprets them with local AI only when explicitly configured by the user, and performs explicit user-defined outputs through normal OS automation APIs. It must not read process memory, hook target apps, inspect network traffic, bypass protections, evade detection, inject code, use hidden drivers, or operate as hidden botting software.

## Principles

- Local-first by default.
- No hidden network calls.
- No credential harvesting.
- No invasive monitoring.
- No process injection, memory reading, packet inspection, hidden drivers, target-app hooks, anti-cheat evasion, or botting features.
- No target-program communication, modification, or hidden instrumentation.
- No autonomous planning or AI-invented actions.
- No cloud provider without explicit user configuration.
- Workflows must be visible, editable, pausable, and disable-able.
- Low-risk configured workflows may run automatically when the user enables or accepts that workflow.
- Screen observation, local AI analysis, proposed actions, browser prompts, and future command help should be requested with explicit capability language.
- Review is required when validation fails or when an action is high risk.
- High-risk actions such as local scripts or keyboard/mouse output must not run automatically in v0.
- Logs should explain what happened without storing screen contents.
- Capture source must be explicit for workflow-driven captures.
- mAIcroFlow UI windows request OS capture exclusion so the user's macro controls do not become part of their own screenshots where supported.
- Unsupported or unavailable capture sources must fail closed.
- A global safety pause shortcut must be available when registration succeeds.
- Active workflow state must remain visible in the UI.

The intended access model is "what the user can already see." mAIcroFlow samples visible screen pixels through normal OS capture APIs, like a screen sharing or meeting app selecting a monitor/window. It does not inspect process memory, hook rendering pipelines, evade detection, or interrupt the target program.

## TOS And Permitted Use Posture

mAIcroFlow is designed to stay on the user-visible side of the boundary: visible pixels in, explicit user-configured actions out. It should not communicate with the target app, modify it, hide from it, bypass protections, or automate high-risk input without explicit safeguards. That design lowers risk, but it is not a blanket guarantee that every third-party app or game permits every workflow under its own terms. When in doubt, users should keep workflows observational or file/clipboard-output oriented and avoid competitive, evasive, or unattended gameplay automation.

Keyboard and mouse output is treated as a high-risk macro action, not as a hidden control layer. Before it is enabled, each emitted sequence should be visible in the workflow, explicitly allowed by the user, and blocked from automatic execution unless the safety policy permits that exact action.

## Allowed Examples

- Extracting values from a visible screenshot into CSV or XLSX.
- Accessibility-style repetitive UI help for a user-controlled workflow.
- Personal offline/local automation.
- Office workflow automation.
- Stream or creator tools that react to visible events or user-approved inputs.
- User-owned app workflows where automation is allowed.

## Disallowed Examples

- Bypassing anti-cheat, platform detection, or access controls.
- Automating competitive online play.
- Farming online economies or reward systems.
- Reading process memory.
- Inspecting network packets.
- Injecting code into apps.
- Installing hidden drivers, hooks, or privileged control layers.
- Hiding automation from the user or using evasion techniques. UI capture exclusion is allowed only as a visible privacy feature so mAIcroFlow controls do not appear in the user's own screenshots.

## Current Enforcement

- Ollama endpoints are restricted to local addresses in v0.
- The live-intention path asks for explicit renderer-side capability approval before region selection, local AI analysis, and action proposals.
- Persistent capability approvals can be revoked from Settings; approve-once and approve-for-session are runtime UI decisions.
- Auto-append is allowed only for low-risk spreadsheet/file append actions.
- Clipboard output is implemented as a review-gated action in v0; selecting it should not silently auto-run.
- Generic macro fields are validated before low-risk file/spreadsheet writes; legacy demo-specific validators are adapters, not the product boundary.
- Overlapping runs are ignored while a workflow is running or awaiting review.
- Run screenshots are temporary processing artifacts and are deleted immediately after extraction.
- Capture source is explicit in the workflow capture node. v0 supports display-under-cursor, primary-display, and specific-monitor capture; app/window selection is planned through normal OS capture APIs.
- Rectangle crops are explicit workflow node configuration and fail closed when malformed.
- Unsupported capture sources and unavailable specific monitors throw an error instead of silently capturing another display.
- Workflow diagnostics warn or block invalid hotkeys, impossible trigger logic, action-like AI prompts, unsafe automatic input actions, unsupported capture sources, and unreasonable output paths.
- `Ctrl+Alt+Shift+P` pauses active workflows and stops watch loops when the shortcut can be registered by the OS.
- Watch mode stores temporary samples in an OS temp `maicroflow/watch-samples` location and deletes no-match samples immediately.
- Watch mode deletes matched samples after the triggered extraction has consumed them.
- Watch mode uses cooldown and duplicate hash checks to avoid repeated appends from unchanged screens.
- AI prompts are node-local implementation details; workflow logic stays in the explicit graph.
- Live-intention suggested actions are stored as reviewed proposal fields and are not executed as input actions.

## Not Yet Implemented

- A full action risk policy UI.
- Backend-enforced capability tokens for every IPC route that can observe the screen or open external tools.
- Signed workflow templates.
- Fine-grained per-action permissions.
- Redaction or deletion tools for saved captures.
- Cloud provider consent and cost controls.
- Configurable watch-sample TTL in the UI.
