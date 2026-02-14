# 🛠️ Claude Code Skills — แนะนำสำหรับ JellyCore

> Skills จาก [skillsmp.com](https://skillsmp.com/) ที่เหมาะกับการพัฒนาโปรเจค JellyCore
> ใช้กับ Claude Code เพื่อเพิ่มความสามารถในการช่วยเขียนโค้ด

**วิธีติดตั้ง:** คลิก "export" ที่ skill ใน skillsmp.com → save เป็น `.md` ใน folder `.claude/skills/` ของโปรเจค

---

## 📋 สรุปย่อ — Top 15 Skills ที่แนะนำ

| # | Skill | ที่มา | ใช้กับ Phase | ทำไมต้องมี |
|---|-------|-------|-------------|-----------|
| 1 | docker-patterns | affaan-m/everything-claude-code | Phase 0, 1, 5 | Docker Compose patterns, container security, networking |
| 2 | mcp-builder | ComposioHQ/awesome-claude-skills | Phase 0, 1 | สร้าง MCP server (Oracle V2 เป็น MCP server) |
| 3 | coding-standards | affaan-m/everything-claude-code | ทุก Phase | TypeScript/Node.js/React best practices |
| 4 | bun-development | davila7/claude-code-templates | Phase 0, 1, 4 | Oracle V2 ใช้ Bun runtime |
| 5 | backend-dev-guidelines | davila7/claude-code-templates | ทุก Phase | Node.js microservices architecture |
| 6 | telegram-bot-builder | davila7/claude-code-templates | Phase 4 | Telegram Bot API, webhook, inline keyboards |
| 7 | add-telegram-swarm | qwibitai/nanoclaw | Phase 4 | NanoClaw's own Telegram skill! |
| 8 | litestream | benbjohnson/litestream | Phase 1, 2 | SQLite WAL, disaster recovery, replication |
| 9 | database-migrations | affaan-m/everything-claude-code | Phase 2, 4 | Schema migration best practices |
| 10 | ui-ux-pro-max | davila7/claude-code-templates | Phase 5 | React + Tailwind + shadcn/ui dashboard |
| 11 | find-bugs | davila7/claude-code-templates | ทุก Phase | Security vulnerabilities, code quality |
| 12 | best-practices | davila7/claude-code-templates | ทุก Phase | Security audit, modernize code |
| 13 | security-scan | affaan-m/everything-claude-code | Phase 0 | Scan .claude/ config for security issues |
| 14 | docker-expert | davila7/claude-code-templates | Phase 0, 5 | Multi-stage builds, optimization, security |
| 15 | code-review | shareAI-lab/learn-claude-code | ทุก Phase | Thorough code review with security analysis |

---

## 🏗️ Skills แยกตาม Phase

### Phase 0 — Security Foundation

| Skill | Link | เหตุผล |
|-------|------|--------|
| **docker-patterns** | [skillsmp.com](https://skillsmp.com/skills/affaan-m-everything-claude-code-skills-docker-patterns-skill-md) | Container security, volume strategies, networking — ใช้ตั้งค่า Docker isolation |
| **mcp-builder** | [skillsmp.com](https://skillsmp.com/skills/composiohq-awesome-claude-skills-mcp-builder-skill-md) | สร้าง MCP server + HTTP bridge สำหรับ Oracle V2 |
| **security-scan** | [skillsmp.com](https://skillsmp.com/skills/affaan-m-everything-claude-code-cursor-skills-security-scan-skill-md) | ตรวจ security config ของ Claude Code setup เอง |
| **best-practices** | [skillsmp.com](https://skillsmp.com/skills/davila7-claude-code-templates-cli-tool-components-skills-development-best-practices-skill-md) | Security audit + code quality review |

### Phase 1 — Performance Upgrade

| Skill | Link | เหตุผล |
|-------|------|--------|
| **litestream** | [skillsmp.com](https://skillsmp.com/skills/benbjohnson-litestream-skills-litestream-skill-md) | SQLite WAL expert knowledge — Item 1.1 ต้องใช้ |
| **bun-development** | [skillsmp.com](https://skillsmp.com/skills/davila7-claude-code-templates-cli-tool-components-skills-development-bun-development-skill-md) | Oracle V2 ใช้ Bun — ช่วย optimize performance |
| **coding-standards** | [skillsmp.com](https://skillsmp.com/skills/affaan-m-everything-claude-code-skills-coding-standards-skill-md) | TypeScript/Node.js patterns สำหรับ NanoClaw |

### Phase 2 — Architecture Hardening

| Skill | Link | เหตุผล |
|-------|------|--------|
| **database-migrations** | [skillsmp.com](https://skillsmp.com/skills/affaan-m-everything-claude-code-skills-database-migrations-skill-md) | Schema migration system — Item 2.7 |
| **backend-dev-guidelines** | [skillsmp.com](https://skillsmp.com/skills/davila7-claude-code-templates-cli-tool-components-skills-development-backend-dev-guidelines-skill-md) | Layered architecture, error handling, testing |

### Phase 3 — Reliability & Resilience

| Skill | Link | เหตุผล |
|-------|------|--------|
| **find-bugs** | [skillsmp.com](https://skillsmp.com/skills/davila7-claude-code-templates-cli-tool-components-skills-sentry-find-bugs-skill-md) | หา bugs + security vulnerabilities ก่อน deploy |
| **code-review** | [skillsmp.com](https://skillsmp.com/skills/shareai-lab-learn-claude-code-skills-code-review-skill-md) | Review circuit breaker, recovery logic |

### Phase 4 — Integration & Intelligence

| Skill | Link | เหตุผล |
|-------|------|--------|
| **telegram-bot-builder** | [skillsmp.com](https://skillsmp.com/skills/davila7-claude-code-templates-cli-tool-components-skills-enterprise-communication-telegram-bot-builder-skill-md) | Expert ใน Telegram Bot API — inline keyboards, webhook, scaling |
| **add-telegram-swarm** | [skillsmp.com](https://skillsmp.com/skills/qwibitai-nanoclaw-claude-skills-add-telegram-swarm-skill-md) | Skill จาก NanoClaw repo เอง — Telegram agent swarm |
| **telegram-automation** | [skillsmp.com](https://skillsmp.com/skills/composiohq-awesome-claude-skills-telegram-automation-skill-md) | Automate Telegram tasks via MCP |
| **mcp-builder** | (ด้านบน) | สร้าง MCP tools ใหม่สำหรับ memory system |

### Phase 5 — Production Polish

| Skill | Link | เหตุผล |
|-------|------|--------|
| **ui-ux-pro-max** | [skillsmp.com](https://skillsmp.com/skills/davila7-claude-code-templates-cli-tool-components-skills-creative-design-ui-ux-pro-max-skill-md) | React + Tailwind + shadcn/ui — สำหรับ Interactive Dashboard |
| **docker-expert** | [skillsmp.com](https://skillsmp.com/skills/davila7-claude-code-templates-cli-tool-components-skills-development-docker-expert-skill-md) | Production Docker optimization, multi-stage builds |

---

## 🎯 Skill Bundles — ติดตั้งทีละชุด

### Bundle 1: Foundation (ติดตั้งตอนเริ่มโปรเจค)
```
.claude/skills/
├── coding-standards.md        # affaan-m/everything-claude-code
├── backend-dev-guidelines.md  # davila7/claude-code-templates
├── best-practices.md          # davila7/claude-code-templates
└── docker-patterns.md         # affaan-m/everything-claude-code
```
> ใช้ตลอดทุก Phase — กำหนด coding style, architecture patterns, security baseline

### Bundle 2: Core Tech (ติดตั้งเมื่อเริ่ม Phase 0-1)
```
.claude/skills/
├── mcp-builder.md             # ComposioHQ/awesome-claude-skills
├── bun-development.md         # davila7/claude-code-templates
├── litestream.md              # benbjohnson/litestream
└── security-scan.md           # affaan-m/everything-claude-code
```
> MCP server building, Bun runtime, SQLite WAL, security scanning

### Bundle 3: Channels (ติดตั้งเมื่อเริ่ม Phase 4)
```
.claude/skills/
├── telegram-bot-builder.md    # davila7/claude-code-templates
├── add-telegram-swarm.md      # qwibitai/nanoclaw
└── telegram-automation.md     # ComposioHQ/awesome-claude-skills
```
> Telegram Bot API expert, NanoClaw integration, automation

### Bundle 4: Quality (ติดตั้งเมื่อเริ่ม Phase 3+)
```
.claude/skills/
├── find-bugs.md               # davila7/claude-code-templates
├── code-review.md             # shareAI-lab/learn-claude-code
└── database-migrations.md     # affaan-m/everything-claude-code
```
> Bug finding, security review, migration safety

### Bundle 5: Dashboard (ติดตั้งเมื่อเริ่ม Phase 5)
```
.claude/skills/
├── ui-ux-pro-max.md           # davila7/claude-code-templates
└── docker-expert.md           # davila7/claude-code-templates
```
> React/Tailwind dashboard building, production Docker

---

## 📝 Bonus Skills — น่าสนใจเพิ่มเติม

| Skill | ที่มา | เหตุผล |
|-------|-------|--------|
| **bullmq-specialist** | davila7/claude-code-templates | Redis-backed job queue — ถ้าต้องการ queue ที่แข็งแรงกว่า in-memory |
| **audit-prep-assistant** | trailofbits/skills | Trail of Bits security checklist — ใช้ก่อน production deploy |
| **database-schema-designer** | davila7/claude-code-templates | Schema design สำหรับ 4-Layer Memory System |
| **epic-caching** | epicweb-dev/epic-stack | SQLite cache + LRU cache patterns |
| **copilot-sdk** | sickn33/antigravity-awesome-skills | GitHub Copilot SDK — MCP server, streaming, custom agents |
| **createos** | openclaw/skills | Deploy to production cloud — ถ้าต้องการ alternative deployment |

---

## 💡 วิธีใช้กับ Claude Code

1. **ดาวน์โหลด skill** จาก skillsmp.com (กดปุ่ม "export")
2. **วางไฟล์** ใน `.claude/skills/` ของ workspace
3. **Claude Code จะอ่านอัตโนมัติ** เมื่อเริ่ม session ใหม่
4. **ไม่ต้อง activate** — skill จะ trigger ตาม context การทำงาน

```bash
# ตัวอย่างการติดตั้ง Bundle 1
mkdir -p .claude/skills
cd .claude/skills

# วิธี 1: ดาวน์โหลดจาก GitHub repo โดยตรง
curl -O https://raw.githubusercontent.com/affaan-m/everything-claude-code/main/skills/coding-standards-skill.md
curl -O https://raw.githubusercontent.com/davila7/claude-code-templates/main/cli-tool-components/skills/development/backend-dev-guidelines-skill.md

# วิธี 2: Copy จาก skillsmp.com export
# กด export ที่หน้า skill → save ไฟล์มาวางใน .claude/skills/
```

---

## ⚠️ หมายเหตุ

- **ไม่ควรติดตั้งเยอะเกินไป** — แนะนำ 5-8 skills ต่อ session เพื่อไม่ให้ context window เต็ม
- **สลับ bundle ตาม Phase** ที่กำลังทำ
- **Skill จาก NanoClaw repo** (`add-telegram-swarm`) เขียนเฉพาะสำหรับโปรเจคนี้
- **ตรวจ skill version** เป็นระยะ — community อัพเดตบ่อย
