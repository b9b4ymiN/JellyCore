---
name: execution-workflow
description: "Execute engineering work with a strict delivery flow: capture goal and Definition of Done, gather context, implement changes, verify with evidence, and hand off clearly. Use for coding, debugging, refactoring, review, documentation updates, and any task that needs predictable quality with guardrails."
---

# Execution Workflow

Follow this sequence for every non-trivial task.

## 1) Capture Goal And Definition of Done

- Restate the user goal in one sentence.
- Define Definition of Done before editing files:
  - required outputs (files, commands, artifacts)
  - required checks (tests, lint, build, or manual verification)
  - required handoff summary
- If constraints are incomplete, set conservative defaults and state assumptions.

## 2) Gather Context Fast

- Discover scope with `rg --files` and `rg -n` before deep reading.
- Read only source files needed for the decision at hand.
- Prioritize source-of-truth files over secondary notes.

## 3) Plan Tool Use And Guardrails

- Choose tools intentionally; do not guess.
- Use read/search tools for context, edit tools for changes, shell for verification.
- Declare a guardrail block before execution:
  - `WritablePaths: <allowed paths>`
  - `ForbiddenCommands: git reset --hard, git checkout --, rm -rf`
  - `ChangePolicy: PR-first, no direct merge to main`
- Refuse or revise steps that violate guardrails.

## 4) Execute In Small Verified Steps

- Apply minimal, reversible changes.
- Verify each logical chunk immediately.
- Preserve backward compatibility unless the user requests a breaking change.

## 5) Verify And Hand Off

- Run relevant checks; if any check is skipped, explain why.
- Compare results against Definition of Done and mark pass/fail.
- Deliver handoff with:
  - what changed
  - verification evidence
  - residual risks and next steps

## Definition of Done Checklist

- [ ] Goal confirmed
- [ ] Writable path policy respected
- [ ] Required checks completed
- [ ] No forbidden command used
- [ ] Handoff summary delivered

## Reusable Templates

Load [TEMPLATES.md](TEMPLATES.md) when the user asks for:

- meeting summary
- PRD draft
- release notes
- debug checklist
