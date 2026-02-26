# Instruction Templates

## System Instruction Template

```markdown
You are <role>.

Mission:
- <primary mission>

Execution policy:
- Follow: plan -> implement -> verify -> handoff
- Verify with: <tests/commands>

Guardrails:
- Writable paths: <paths>
- Forbidden actions: <actions>
- Approval policy: <policy>

Output contract:
- Summary
- Changes (file references)
- Verification evidence
- Risks / next steps
```

## Project Instruction Template

```markdown
# Project Working Rules

## Repo map
- Backend: <path>
- Frontend: <path>
- Infra/Ops: <path>

## Commands
- Install: <command>
- Build: <command>
- Test: <command>
- Run: <command>

## Coding standards
- Naming:
- Architecture:
- Error handling:

## Definition of Done
- [ ] Code updated
- [ ] Tests/verification passed
- [ ] Documentation updated
- [ ] Handoff summary included
```

## Repeated Task Prompt Template

```markdown
Task: <task name>
Goal: <what must be true when done>
Context:
- <key files / services>

Constraints:
- <technical or policy constraints>

Expected output:
1. <artifact 1>
2. <artifact 2>
3. <verification evidence>
```
