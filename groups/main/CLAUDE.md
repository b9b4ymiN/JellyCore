# Main Channel Instructions

## First — Know Your Context

1. Read `/workspace/global/SOUL.md` — your identity and personality
2. Read `/workspace/group/USER.md` — info about the person you're helping (update this as you learn new things about them)

## Capabilities

- Answer questions and have conversations
- Search the web and fetch content from URLs
- Browse the web with `agent-browser`
- Read and write files in your workspace
- Run bash commands in your sandbox
- Schedule tasks to run later or on a recurring basis
- Send messages back to the chat

---

## Admin Context

This is the **main channel**, which has elevated privileges.

## Container Mounts

Main has access to its own workspace:

| Container Path | Description | Access |
|----------------|-------------|--------|
| `/workspace/group` | Main group folder (`groups/main/`) | read-write |
| `/workspace/global` | Global memory (`groups/global/`) | read-only |
| `/workspace/ipc` | IPC directory (messages, tasks, input) | read-write |

> **Note**: You do NOT have direct access to the project root, store, or other groups' folders.
> Use IPC and Oracle MCP tools to interact with the system.

---

## Managing Groups

### Finding Available Groups

Available groups are provided in `/workspace/ipc/available_groups.json`:

```json
{
  "groups": [
    {
      "jid": "120363336345536173@g.us",
      "name": "Family Chat",
      "lastActivity": "2026-01-31T12:00:00.000Z",
      "isRegistered": false
    }
  ],
  "lastSync": "2026-01-31T12:00:00.000Z"
}
```

Groups are ordered by most recent activity. The list is synced from WhatsApp daily.

If a group the user mentions isn't in the list, request a fresh sync:

```bash
echo '{"type": "refresh_groups"}' > /workspace/ipc/tasks/refresh_$(date +%s).json
```

Then wait a moment and re-read `available_groups.json`.

**Fallback**: Use the Oracle MCP tools to query information — the agent does not have direct database access.

### Registered Groups Config

Groups are registered via the `registered_groups.json` file managed by NanoClaw. To view or modify group registrations, use IPC commands:

Write a request to `/workspace/ipc/tasks/`:

```bash
echo '{"type": "list_groups"}' > /workspace/ipc/tasks/list_$(date +%s).json
```

Fields:
- **Key**: The WhatsApp JID (unique identifier for the chat)
- **name**: Display name for the group
- **folder**: Folder name under `groups/` for this group's files and memory
- **trigger**: The trigger word (usually same as global, but could differ)
- **requiresTrigger**: Whether `@trigger` prefix is needed (default: `true`). Set to `false` for solo/personal chats where all messages should be processed
- **added_at**: ISO timestamp when registered

### Trigger Behavior

- **Main group**: No trigger needed — all messages are processed automatically
- **Groups with `requiresTrigger: false`**: No trigger needed — all messages processed (use for 1-on-1 or solo chats)
- **Other groups** (default): Messages must start with `@AssistantName` to be processed

### Adding a Group

1. Write a task file to `/workspace/ipc/tasks/` requesting the group be registered
2. Include the group's JID, desired folder name, and trigger word
3. NanoClaw will create the group folder and configuration automatically

Example IPC task:
```bash
cat > /workspace/ipc/tasks/add_group_$(date +%s).json << 'EOF'
{
  "type": "register_group",
  "jid": "120363336345536173@g.us",
  "name": "Family Chat",
  "folder": "family-chat",
  "trigger": "@Andy"
}
EOF
```

Example folder name conventions:
- "Family Chat" → `family-chat`
- "Work Team" → `work-team`
- Use lowercase, hyphens instead of spaces

#### Adding Additional Directories for a Group

Groups can have extra directories mounted. Add `containerConfig` to their entry:

```json
{
  "1234567890@g.us": {
    "name": "Dev Team",
    "folder": "dev-team",
    "trigger": "@Andy",
    "added_at": "2026-01-31T12:00:00Z",
    "containerConfig": {
      "additionalMounts": [
        {
          "hostPath": "~/projects/webapp",
          "containerPath": "webapp",
          "readonly": false
        }
      ]
    }
  }
}
```

The directory will appear at `/workspace/extra/webapp` in that group's container.

### Removing a Group

1. Write a task file to `/workspace/ipc/tasks/` requesting the group be unregistered
2. The group folder and its files remain (don't delete them)

### Listing Groups

Write a task to IPC or use the Oracle MCP tool `oracle_search` with a query about groups.

---

## Global Memory

You can read `/workspace/global/CLAUDE.md` for global instructions. To update global memory, use the Oracle MCP tools (`oracle_learn`, `oracle_user_model_update`) which persist across all sessions and groups.

---

## Scheduling for Other Groups

When scheduling tasks for other groups, use the `target_group_jid` parameter with the group's JID from `registered_groups.json`:
- `schedule_task(prompt: "...", schedule_type: "cron", schedule_value: "0 9 * * 1", target_group_jid: "120363336345536173@g.us")`

The task will run in that group's context with access to their files and memory.
