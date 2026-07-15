# Roadmap

This is a v0 utility, not an enterprise platform. The next work should make the current workflow loop more trustworthy before adding breadth.

## Near Term

- Turn reviewed live-intention proposal fields into a clearer editable workflow proposal/diff surface.
- Add backend-enforced capability tokens for screen observation and external-tool IPC routes.
- Add active-window capture.
- Add explicit app/window picker for capture sources.
- Add drag-to-select rectangle tooling on top of the existing explicit region crop config.
- Add reference-image trigger nodes with optional highlighted regions, confidence, and debug reasons.
- Add visible boolean trigger groups: all/any combinations of hotkeys, visual matches, and model-interpreted screen states.
- Add a training wizard for example screenshots, field labels, node prompt/schema generation, and reusable extraction tests.
- Improve the deterministic XLSX output renderer for formatting, pinned summary/dashboard sections, and safer behavior when Excel has the workbook open.
- Broaden reviewed clipboard output into richer low-risk local action patterns only when they remain explicit and inspectable.
- Add future workflow migrations through the current v0-to-v1 migration registry as the JSON shape evolves.
- Improve hotkey conflict handling, tray pause/resume, and safety-pause visibility.

## Later

- Small popup output for computed values.
- Policy-gated keyboard/mouse output nodes for explicit local macros.
- Import/export for shareable workflow templates.

## Not A Goal Right Now

- Plugin marketplace.
- Autonomous agent platform.
- Natural-language workflow planning.
- Generalized DAG engine.
- Anti-cheat or stealth automation.
- Process injection or memory-reading automation.
- Packet inspection or target-app network introspection.
- Hidden drivers or privileged hooks.
- Cloud dependencies.
- Unrestricted scripting or unattended high-risk keyboard/mouse automation.
