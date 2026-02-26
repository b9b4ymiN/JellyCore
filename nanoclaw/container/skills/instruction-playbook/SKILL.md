---
name: instruction-playbook
description: "Design practical AI instructions and prompts for engineering work: system instructions, project instructions, guardrails, and reusable task prompts. Use when creating or refining instructions so behavior is predictable, testable, and aligned with repo standards."
---

# Instruction Playbook

Use this skill when writing or refactoring AI instructions.

## Instruction Design Flow

1. Define operating scope
- repository boundaries
- runtime dependencies
- test/build commands

2. Define quality bar
- coding standards
- verification requirements
- Definition of Done

3. Define guardrails
- writable paths
- forbidden commands/actions
- approval and merge policy

4. Define response contract
- expected output structure
- mandatory evidence fields (tests, logs, links)

5. Add reusable templates for recurring tasks

## Guardrail Patterns

- Prefer specific allowed behavior over broad restrictions.
- Make risky actions explicit and deny-by-default.
- Tie each guardrail to a concrete failure mode.

## Validation Checklist

- Is every instruction testable?
- Is every restriction enforceable?
- Is output format clear enough for automated review?
- Are examples aligned with current repo workflows?

Load [TEMPLATES.md](TEMPLATES.md) for copy-ready instruction templates.
