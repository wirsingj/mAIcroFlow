# Manual Test Checklist

## First Launch

- Run `npm install`.
- Run `npm run dev`.
- Confirm the app opens to the Workflows page.
- Click New Macro.
- Confirm a paused New Macro appears with one visible Trigger bubble.
- Confirm the builder reads like a simple bubble flow, not a settings wizard.
- Confirm the Details/advanced toggle is collapsed by default.
- Click New Live Flow.
- Confirm permission prompts use explicit capability wording and offer Approve Once, This Session, Do Not Ask Again, and Deny.
- Approve region capture and drag-select a non-sensitive screen rectangle.
- Confirm a paused Live Intention Flow appears with the selected region and fields for visible_state, repeatable_pattern, guard_condition, and suggested_action.
- Open Settings, confirm persistent approvals are visible, and revoke any approval that was saved with Do Not Ask Again.

## First Macro Flow

- Paste or import a reference screenshot into the trigger bubble.
- Confirm newly pasted/imported references are stored as PNG files under `data/examples`.
- Add a Screen Grab bubble.
- Add an AI Extract bubble and set fields such as `name`, `status`, `amount`, or any visible values for the target screen.
- Add an Output bubble and choose CSV, XLSX, or reviewed clipboard.
- If using file output, choose or confirm the output folder and file name.
- Click Save and Run Test.
- Confirm the interactive progress bar advances through capture, extract, validation/review, output, and done/failed.
- If output succeeds, click the progress bar Output button and confirm the target file/folder opens.
- Open a visible target screen that matches the flow.
- Confirm the workflow captures, extracts, writes output or opens review, and returns to armed without focusing the app when validation passes.
- Optionally paste manual extractor text:
  - `Fish: Glacier Trout`
  - `EXP: 140`
  - `Weight: 2.6 lb`
  - `Tier: Rare`
  - `Bait: Minnow`
- Click Save and Run Test.
- Confirm no persistent run screenshot is left behind; run captures are temporary processing artifacts.
- If Ollama is running with the configured vision model, confirm the modal notes mention local Ollama vision extraction.
- If Ollama is not running, confirm the modal still opens with deterministic fallback notes.
- If validation fails, confirm Save and Run Test opens the review/edit modal.
- Edit at least one field.
- Click Save Row.
- Confirm the configured CSV has a new row.
- Change the output type to Copy to clipboard.
- Confirm auto-run is disabled/review-first for the workflow.
- Run again, click Copy in the review modal, and confirm the clipboard contains the reviewed structured fields.

## Live Intention Flow

- With a Live Intention Flow selected, confirm the live draft card shows the selected x/y/width/height.
- Click Run Test.
- Approve screen observation and local AI analysis if prompted.
- If Ollama is running, confirm the review modal contains proposed interpretation fields rather than an executed action.
- Edit the suggested_action field and approve the reviewed output.
- Confirm the node-level diff lists the trigger/extract/review/action changes.
- Click Apply to Draft and confirm the workflow remains paused while node summaries/prompts reflect the reviewed proposal.
- Confirm no keyboard or mouse action fires automatically.
- Confirm the workflow remains paused until explicitly armed.

## Safety Controls

- Click Float.
- Confirm the small mAIcroFlow control can be dragged to another monitor and the full app hides.
- If more than one workflow exists, choose a workflow in the floating control and confirm Run/Region target that workflow.
- Open the full app from the floating control.
- On supported Windows builds, confirm captures do not include the mAIcroFlow control window.
- Press `Ctrl+Alt+Shift+P`.
- Confirm active workflows pause and watch sampling stops.
- Confirm the app logs the safety pause event.
- Change the workflow Output folder or File name, save the workflow, run again, and confirm the row is written to the new destination.
- From the floating control, click Region, drag a rectangle, and confirm the active workflow's capture node is set to a specific monitor with the picked x/y/width/height.

## Hotkey

- With the app running, press the workflow's configured hotkey. The starter flow defaults to F12.
- Confirm a valid extraction appends without stealing focus.
- If validation fails, confirm the app opens or focuses with a review modal.
- If the configured hotkey is already owned by another app, use Run Test and check `data/app.log` for a registration warning.

## AI Setup

- Open AI Setup.
- Click Check Again.
- Confirm the status reflects whether Ollama is reachable at `localhost:11434`.
- Change the preferred model and save settings.

## Safety

- Confirm Save and Trust Later is disabled in the confirmation modal.
- Confirm browser setup links request browser-prompt approval before opening.
- Confirm command help is listed as a future permission shape in Settings but has no runnable path.
- Confirm local script actions are not implemented yet.
- Confirm logs contain paths and event metadata, not screenshot contents.
- Enable Watch for matching screen, confirm no-match samples do not remain in the OS temp `maicroflow/watch-samples` folder.
- Confirm detection logs include sample_created, detection_no_match_deleted or detection_match, sample_deleted, and run_capture_created.
- Confirm the Run Inspector Watch decision row explains baseline, duplicate, no-match, or match decisions.
- Confirm detection details show loaded/missing references and deterministic reference scores when trigger screenshots are attached.
- Confirm clicking progress bar steps opens the Run Inspector for the latest run.
- Enable rectangle crop on a capture node, use Pick Region, save, and confirm watch/run captures use the selected rectangle.
- Enter malformed x/y/width/height values and confirm malformed rectangles are blocked by Workflow checks.
