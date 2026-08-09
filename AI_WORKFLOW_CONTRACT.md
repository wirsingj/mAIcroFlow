# AI Workflow Contract

mAIcroFlow treats AI as one implementation detail inside a visible macro workflow. The workflow graph is the product boundary.

## Doctrine

1. Visible pixels and explicit user inputs are the only observation sources for v0.
2. Workflow JSON, node configs, reference images, and run traces are the source of truth.
3. Local AI may interpret captures, but it must return structured data for validation.
4. Bad model output is expected and must not mutate output without passing workflow guards.
5. Actions are explicit configured nodes, not free-form agent behavior.
6. Run artifacts should be inspectable through logs, structured observations, and review state.
7. Cuddler and OllamaSaddle should be future adapters, not required runtime dependencies.
8. Build useful macro rails before expanding provider cleverness.

## Provider Contract

Providers receive structured workflow context:

```json
{
  "workflow": "typed workflow JSON",
  "node": "trigger or extract node config",
  "references": ["explicit #ref images owned by the node"],
  "capture": "latest visible screen artifact",
  "requiredFields": ["configured output fields"]
}
```

Providers return structured results:

```json
{
  "fields": {
    "name": "visible value"
  },
  "confidence": 0.82,
  "notes": "short reason"
}
```

Detection providers return a visual trigger result:

```json
{
  "match": true,
  "confidence": 0.92,
  "reason": "short reason",
  "matched_references": ["#ref1"]
}
```

The runner normalizes the result into match/skipped status, confidence, matched references, and a human-readable reason. Configured confidence thresholds can turn a low-confidence model match into a logged no-match instead of firing the workflow.

## Rejected Behavior

Providers must not:

- Apply actions directly.
- Return prose or markdown as the primary output.
- Infer hidden data, credentials, memory, packets, or process state.
- Use non-local endpoints unless a future explicit provider policy allows it.
- Modify workflow JSON outside a reviewed structured patch path.
- Bypass validation, review, output policy, or run logging.

## Cuddler And OllamaSaddle Direction

Cuddler may eventually prepare project context, prompts, files, or provider windows. OllamaSaddle may eventually normalize local/provider calls. In both cases, mAIcroFlow should accept structured workflow requests and return structured run results.

The integration shape should be:

```text
Cuddler/OllamaSaddle -> structured workflow request -> mAIcroFlow runner -> structured trace/result
```

The app should remain useful when neither tool is present.
