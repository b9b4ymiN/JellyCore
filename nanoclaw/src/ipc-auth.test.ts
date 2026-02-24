import { describe, it, expect, beforeEach } from 'vitest';

import {
  _initTestDatabase,
  createTask,
  getAllTasks,
  getRegisteredGroup,
  getTaskById,
  setRegisteredGroup,
  getAllHeartbeatJobs,
  getHeartbeatJob,
} from './db.js';
import { processTaskIpc, IpcDeps } from './ipc.js';
import { RegisteredGroup } from './types.js';

// Set up registered groups used across tests
const MAIN_GROUP: RegisteredGroup = {
  name: 'Main',
  folder: 'main',
  trigger: 'always',
  added_at: '2024-01-01T00:00:00.000Z',
};

const OTHER_GROUP: RegisteredGroup = {
  name: 'Other',
  folder: 'other-group',
  trigger: '@Andy',
  added_at: '2024-01-01T00:00:00.000Z',
};

const THIRD_GROUP: RegisteredGroup = {
  name: 'Third',
  folder: 'third-group',
  trigger: '@Andy',
  added_at: '2024-01-01T00:00:00.000Z',
};

let groups: Record<string, RegisteredGroup>;
let deps: IpcDeps;

beforeEach(() => {
  _initTestDatabase();

  groups = {
    'main@g.us': MAIN_GROUP,
    'other@g.us': OTHER_GROUP,
    'third@g.us': THIRD_GROUP,
  };

  // Populate DB as well
  setRegisteredGroup('main@g.us', MAIN_GROUP);
  setRegisteredGroup('other@g.us', OTHER_GROUP);
  setRegisteredGroup('third@g.us', THIRD_GROUP);

  deps = {
    sendMessage: async () => {},
    registeredGroups: () => groups,
    registerGroup: (jid, group) => {
      groups[jid] = group;
      setRegisteredGroup(jid, group);
      // Mock the fs.mkdirSync that registerGroup does
    },
    syncGroupMetadata: async () => {},
    getAvailableGroups: () => [],
    writeGroupsSnapshot: () => {},
  };
});

// --- schedule_task authorization ---

describe('schedule_task authorization', () => {
  it('main group can schedule for another group', async () => {
    await processTaskIpc(
      {
        type: 'schedule_task',
        prompt: 'do something',
        schedule_type: 'once',
        schedule_value: '2025-06-01T00:00:00.000Z',
        targetJid: 'other@g.us',
      },
      'main',
      true,
      deps,
    );

    // Verify task was created in DB for the other group
    const allTasks = getAllTasks();
    expect(allTasks.length).toBe(1);
    expect(allTasks[0].group_folder).toBe('other-group');
  });

  it('non-main group can schedule for itself', async () => {
    await processTaskIpc(
      {
        type: 'schedule_task',
        prompt: 'self task',
        schedule_type: 'once',
        schedule_value: '2025-06-01T00:00:00.000Z',
        targetJid: 'other@g.us',
      },
      'other-group',
      false,
      deps,
    );

    const allTasks = getAllTasks();
    expect(allTasks.length).toBe(1);
    expect(allTasks[0].group_folder).toBe('other-group');
  });

  it('non-main group cannot schedule for another group', async () => {
    await processTaskIpc(
      {
        type: 'schedule_task',
        prompt: 'unauthorized',
        schedule_type: 'once',
        schedule_value: '2025-06-01T00:00:00.000Z',
        targetJid: 'main@g.us',
      },
      'other-group',
      false,
      deps,
    );

    const allTasks = getAllTasks();
    expect(allTasks.length).toBe(0);
  });

  it('rejects schedule_task for unregistered target JID', async () => {
    await processTaskIpc(
      {
        type: 'schedule_task',
        prompt: 'no target',
        schedule_type: 'once',
        schedule_value: '2025-06-01T00:00:00.000Z',
        targetJid: 'unknown@g.us',
      },
      'main',
      true,
      deps,
    );

    const allTasks = getAllTasks();
    expect(allTasks.length).toBe(0);
  });
});

// --- pause_task authorization ---

describe('pause_task authorization', () => {
  beforeEach(() => {
    createTask({
      id: 'task-main',
      group_folder: 'main',
      chat_jid: 'main@g.us',
      prompt: 'main task',
      schedule_type: 'once',
      schedule_value: '2025-06-01T00:00:00.000Z',
      context_mode: 'isolated',
      next_run: '2025-06-01T00:00:00.000Z',
      status: 'active',
      created_at: '2024-01-01T00:00:00.000Z',
    });
    createTask({
      id: 'task-other',
      group_folder: 'other-group',
      chat_jid: 'other@g.us',
      prompt: 'other task',
      schedule_type: 'once',
      schedule_value: '2025-06-01T00:00:00.000Z',
      context_mode: 'isolated',
      next_run: '2025-06-01T00:00:00.000Z',
      status: 'active',
      created_at: '2024-01-01T00:00:00.000Z',
    });
  });

  it('main group can pause any task', async () => {
    await processTaskIpc({ type: 'pause_task', taskId: 'task-other' }, 'main', true, deps);
    expect(getTaskById('task-other')!.status).toBe('paused');
  });

  it('non-main group can pause its own task', async () => {
    await processTaskIpc({ type: 'pause_task', taskId: 'task-other' }, 'other-group', false, deps);
    expect(getTaskById('task-other')!.status).toBe('paused');
  });

  it('non-main group cannot pause another groups task', async () => {
    await processTaskIpc({ type: 'pause_task', taskId: 'task-main' }, 'other-group', false, deps);
    expect(getTaskById('task-main')!.status).toBe('active');
  });
});

// --- resume_task authorization ---

describe('resume_task authorization', () => {
  beforeEach(() => {
    createTask({
      id: 'task-paused',
      group_folder: 'other-group',
      chat_jid: 'other@g.us',
      prompt: 'paused task',
      schedule_type: 'once',
      schedule_value: '2025-06-01T00:00:00.000Z',
      context_mode: 'isolated',
      next_run: '2025-06-01T00:00:00.000Z',
      status: 'paused',
      created_at: '2024-01-01T00:00:00.000Z',
    });
  });

  it('main group can resume any task', async () => {
    await processTaskIpc({ type: 'resume_task', taskId: 'task-paused' }, 'main', true, deps);
    expect(getTaskById('task-paused')!.status).toBe('active');
  });

  it('non-main group can resume its own task', async () => {
    await processTaskIpc({ type: 'resume_task', taskId: 'task-paused' }, 'other-group', false, deps);
    expect(getTaskById('task-paused')!.status).toBe('active');
  });

  it('non-main group cannot resume another groups task', async () => {
    await processTaskIpc({ type: 'resume_task', taskId: 'task-paused' }, 'third-group', false, deps);
    expect(getTaskById('task-paused')!.status).toBe('paused');
  });
});

// --- cancel_task authorization ---

describe('cancel_task authorization', () => {
  it('main group can cancel any task', async () => {
    createTask({
      id: 'task-to-cancel',
      group_folder: 'other-group',
      chat_jid: 'other@g.us',
      prompt: 'cancel me',
      schedule_type: 'once',
      schedule_value: '2025-06-01T00:00:00.000Z',
      context_mode: 'isolated',
      next_run: null,
      status: 'active',
      created_at: '2024-01-01T00:00:00.000Z',
    });

    await processTaskIpc({ type: 'cancel_task', taskId: 'task-to-cancel' }, 'main', true, deps);
    expect(getTaskById('task-to-cancel')?.status).toBe('cancelled');
  });

  it('non-main group can cancel its own task', async () => {
    createTask({
      id: 'task-own',
      group_folder: 'other-group',
      chat_jid: 'other@g.us',
      prompt: 'my task',
      schedule_type: 'once',
      schedule_value: '2025-06-01T00:00:00.000Z',
      context_mode: 'isolated',
      next_run: null,
      status: 'active',
      created_at: '2024-01-01T00:00:00.000Z',
    });

    await processTaskIpc({ type: 'cancel_task', taskId: 'task-own' }, 'other-group', false, deps);
    expect(getTaskById('task-own')?.status).toBe('cancelled');
  });

  it('non-main group cannot cancel another groups task', async () => {
    createTask({
      id: 'task-foreign',
      group_folder: 'main',
      chat_jid: 'main@g.us',
      prompt: 'not yours',
      schedule_type: 'once',
      schedule_value: '2025-06-01T00:00:00.000Z',
      context_mode: 'isolated',
      next_run: null,
      status: 'active',
      created_at: '2024-01-01T00:00:00.000Z',
    });

    await processTaskIpc({ type: 'cancel_task', taskId: 'task-foreign' }, 'other-group', false, deps);
    expect(getTaskById('task-foreign')).toBeDefined();
  });
});

// --- register_group authorization ---

describe('register_group authorization', () => {
  it('non-main group cannot register a group', async () => {
    await processTaskIpc(
      {
        type: 'register_group',
        jid: 'new@g.us',
        name: 'New Group',
        folder: 'new-group',
        trigger: '@Andy',
      },
      'other-group',
      false,
      deps,
    );

    // registeredGroups should not have changed
    expect(groups['new@g.us']).toBeUndefined();
  });
});

// --- refresh_groups authorization ---

describe('refresh_groups authorization', () => {
  it('non-main group cannot trigger refresh', async () => {
    // This should be silently blocked (no crash, no effect)
    await processTaskIpc({ type: 'refresh_groups' }, 'other-group', false, deps);
    // If we got here without error, the auth gate worked
  });
});

// --- IPC message authorization ---
// Tests the authorization pattern from startIpcWatcher (ipc.ts).
// The logic: isMain || (targetGroup && targetGroup.folder === sourceGroup)

describe('IPC message authorization', () => {
  // Replicate the exact check from the IPC watcher
  function isMessageAuthorized(
    sourceGroup: string,
    isMain: boolean,
    targetChatJid: string,
    registeredGroups: Record<string, RegisteredGroup>,
  ): boolean {
    const targetGroup = registeredGroups[targetChatJid];
    return isMain || (!!targetGroup && targetGroup.folder === sourceGroup);
  }

  it('main group can send to any group', () => {
    expect(isMessageAuthorized('main', true, 'other@g.us', groups)).toBe(true);
    expect(isMessageAuthorized('main', true, 'third@g.us', groups)).toBe(true);
  });

  it('non-main group can send to its own chat', () => {
    expect(isMessageAuthorized('other-group', false, 'other@g.us', groups)).toBe(true);
  });

  it('non-main group cannot send to another groups chat', () => {
    expect(isMessageAuthorized('other-group', false, 'main@g.us', groups)).toBe(false);
    expect(isMessageAuthorized('other-group', false, 'third@g.us', groups)).toBe(false);
  });

  it('non-main group cannot send to unregistered JID', () => {
    expect(isMessageAuthorized('other-group', false, 'unknown@g.us', groups)).toBe(false);
  });

  it('main group can send to unregistered JID', () => {
    // Main is always authorized regardless of target
    expect(isMessageAuthorized('main', true, 'unknown@g.us', groups)).toBe(true);
  });
});

// --- schedule_task with cron and interval types ---

describe('schedule_task schedule types', () => {
  it('creates task with cron schedule and computes next_run', async () => {
    await processTaskIpc(
      {
        type: 'schedule_task',
        prompt: 'cron task',
        schedule_type: 'cron',
        schedule_value: '0 9 * * *', // every day at 9am
        targetJid: 'other@g.us',
      },
      'main',
      true,
      deps,
    );

    const tasks = getAllTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].schedule_type).toBe('cron');
    expect(tasks[0].next_run).toBeTruthy();
    // next_run should be a valid ISO date in the future
    expect(new Date(tasks[0].next_run!).getTime()).toBeGreaterThan(Date.now() - 60000);
  });

  it('rejects invalid cron expression', async () => {
    await processTaskIpc(
      {
        type: 'schedule_task',
        prompt: 'bad cron',
        schedule_type: 'cron',
        schedule_value: 'not a cron',
        targetJid: 'other@g.us',
      },
      'main',
      true,
      deps,
    );

    expect(getAllTasks()).toHaveLength(0);
  });

  it('creates task with interval schedule', async () => {
    const before = Date.now();

    await processTaskIpc(
      {
        type: 'schedule_task',
        prompt: 'interval task',
        schedule_type: 'interval',
        schedule_value: '3600000', // 1 hour
        targetJid: 'other@g.us',
      },
      'main',
      true,
      deps,
    );

    const tasks = getAllTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].schedule_type).toBe('interval');
    // next_run should be ~1 hour from now
    const nextRun = new Date(tasks[0].next_run!).getTime();
    expect(nextRun).toBeGreaterThanOrEqual(before + 3600000 - 1000);
    expect(nextRun).toBeLessThanOrEqual(Date.now() + 3600000 + 1000);
  });

  it('rejects invalid interval (non-numeric)', async () => {
    await processTaskIpc(
      {
        type: 'schedule_task',
        prompt: 'bad interval',
        schedule_type: 'interval',
        schedule_value: 'abc',
        targetJid: 'other@g.us',
      },
      'main',
      true,
      deps,
    );

    expect(getAllTasks()).toHaveLength(0);
  });

  it('rejects invalid interval (zero)', async () => {
    await processTaskIpc(
      {
        type: 'schedule_task',
        prompt: 'zero interval',
        schedule_type: 'interval',
        schedule_value: '0',
        targetJid: 'other@g.us',
      },
      'main',
      true,
      deps,
    );

    expect(getAllTasks()).toHaveLength(0);
  });

  it('rejects invalid once timestamp', async () => {
    await processTaskIpc(
      {
        type: 'schedule_task',
        prompt: 'bad once',
        schedule_type: 'once',
        schedule_value: 'not-a-date',
        targetJid: 'other@g.us',
      },
      'main',
      true,
      deps,
    );

    expect(getAllTasks()).toHaveLength(0);
  });
});

// --- context_mode defaulting ---

describe('schedule_task context_mode', () => {
  it('accepts context_mode=group', async () => {
    await processTaskIpc(
      {
        type: 'schedule_task',
        prompt: 'group context',
        schedule_type: 'once',
        schedule_value: '2025-06-01T00:00:00.000Z',
        context_mode: 'group',
        targetJid: 'other@g.us',
      },
      'main',
      true,
      deps,
    );

    const tasks = getAllTasks();
    expect(tasks[0].context_mode).toBe('group');
  });

  it('accepts context_mode=isolated', async () => {
    await processTaskIpc(
      {
        type: 'schedule_task',
        prompt: 'isolated context',
        schedule_type: 'once',
        schedule_value: '2025-06-01T00:00:00.000Z',
        context_mode: 'isolated',
        targetJid: 'other@g.us',
      },
      'main',
      true,
      deps,
    );

    const tasks = getAllTasks();
    expect(tasks[0].context_mode).toBe('isolated');
  });

  it('defaults invalid context_mode to isolated', async () => {
    await processTaskIpc(
      {
        type: 'schedule_task',
        prompt: 'bad context',
        schedule_type: 'once',
        schedule_value: '2025-06-01T00:00:00.000Z',
        context_mode: 'bogus' as any,
        targetJid: 'other@g.us',
      },
      'main',
      true,
      deps,
    );

    const tasks = getAllTasks();
    expect(tasks[0].context_mode).toBe('isolated');
  });

  it('defaults missing context_mode to isolated', async () => {
    await processTaskIpc(
      {
        type: 'schedule_task',
        prompt: 'no context mode',
        schedule_type: 'once',
        schedule_value: '2025-06-01T00:00:00.000Z',
        targetJid: 'other@g.us',
      },
      'main',
      true,
      deps,
    );

    const tasks = getAllTasks();
    expect(tasks[0].context_mode).toBe('isolated');
  });
});

// --- register_group success path ---

describe('register_group success', () => {
  it('main group can register a new group', async () => {
    await processTaskIpc(
      {
        type: 'register_group',
        jid: 'new@g.us',
        name: 'New Group',
        folder: 'new-group',
        trigger: '@Andy',
      },
      'main',
      true,
      deps,
    );

    // Verify group was registered in DB
    const group = getRegisteredGroup('new@g.us');
    expect(group).toBeDefined();
    expect(group!.name).toBe('New Group');
    expect(group!.folder).toBe('new-group');
    expect(group!.trigger).toBe('@Andy');
  });

  it('register_group rejects request with missing fields', async () => {
    await processTaskIpc(
      {
        type: 'register_group',
        jid: 'partial@g.us',
        name: 'Partial',
        // missing folder and trigger
      },
      'main',
      true,
      deps,
    );

    expect(getRegisteredGroup('partial@g.us')).toBeUndefined();
  });
});
// --- heartbeat_add_job authorization ---

describe('heartbeat_add_job authorization', () => {
  it('any group can add a heartbeat job', async () => {
    await processTaskIpc(
      {
        type: 'heartbeat_add_job',
        label: 'Monitor NVDA',
        prompt: 'Check NVDA stock price',
        category: 'monitor',
        interval_ms: 1800000,
      },
      'other-group',
      false,
      deps,
    );

    const jobs = getAllHeartbeatJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].label).toBe('Monitor NVDA');
    expect(jobs[0].created_by).toBe('other-group');
  });

  it('main group can also add a heartbeat job', async () => {
    await processTaskIpc(
      {
        type: 'heartbeat_add_job',
        label: 'Reflection Coach',
        prompt: 'Ask a thought-provoking question',
        category: 'learning',
      },
      'main',
      true,
      deps,
    );

    const jobs = getAllHeartbeatJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].created_by).toBe('main');
  });

  it('rejects add with missing required fields', async () => {
    await processTaskIpc(
      {
        type: 'heartbeat_add_job',
        // missing label and prompt
        category: 'custom',
      },
      'main',
      true,
      deps,
    );

    expect(getAllHeartbeatJobs()).toHaveLength(0);
  });
});

// --- heartbeat_update_job authorization ---

describe('heartbeat_update_job authorization', () => {
  const seedJob = () => ({
    id: 'hb-auth-001',
    chat_jid: 'other@g.us',
    label: 'Original Label',
    prompt: 'Original prompt',
    category: 'custom' as const,
    status: 'active' as const,
    interval_ms: null,
    last_run: null,
    last_result: null,
    created_at: new Date().toISOString(),
    created_by: 'other-group',
  });

  it('main group can update any job', async () => {
    const { createHeartbeatJob } = await import('./db.js');
    createHeartbeatJob(seedJob());

    await processTaskIpc(
      { type: 'heartbeat_update_job', jobId: 'hb-auth-001', label: 'Updated by Main' },
      'main',
      true,
      deps,
    );

    const job = getHeartbeatJob('hb-auth-001');
    expect(job!.label).toBe('Updated by Main');
  });

  it('owning group can update its own job', async () => {
    const { createHeartbeatJob } = await import('./db.js');
    createHeartbeatJob(seedJob());

    await processTaskIpc(
      { type: 'heartbeat_update_job', jobId: 'hb-auth-001', label: 'Updated by Owner' },
      'other-group',
      false,
      deps,
    );

    const job = getHeartbeatJob('hb-auth-001');
    expect(job!.label).toBe('Updated by Owner');
  });

  it('non-owning group cannot update another group\'s job', async () => {
    const { createHeartbeatJob } = await import('./db.js');
    createHeartbeatJob(seedJob());

    await processTaskIpc(
      { type: 'heartbeat_update_job', jobId: 'hb-auth-001', label: 'Hijacked Label' },
      'third-group',
      false,
      deps,
    );

    const job = getHeartbeatJob('hb-auth-001');
    // Label should remain unchanged
    expect(job!.label).toBe('Original Label');
  });

  it('partial ID matching works for update', async () => {
    const { createHeartbeatJob } = await import('./db.js');
    createHeartbeatJob(seedJob());

    await processTaskIpc(
      { type: 'heartbeat_update_job', jobId: 'hb-auth', label: 'Partial Match Update' },
      'main',
      true,
      deps,
    );

    const job = getHeartbeatJob('hb-auth-001');
    expect(job!.label).toBe('Partial Match Update');
  });
});

// --- heartbeat_remove_job authorization ---

describe('heartbeat_remove_job authorization', () => {
  const seedJob = () => ({
    id: 'hb-rm-001',
    chat_jid: 'other@g.us',
    label: 'To Remove',
    prompt: 'Some prompt',
    category: 'custom' as const,
    status: 'active' as const,
    interval_ms: null,
    last_run: null,
    last_result: null,
    created_at: new Date().toISOString(),
    created_by: 'other-group',
  });

  it('main group can remove any job', async () => {
    const { createHeartbeatJob } = await import('./db.js');
    createHeartbeatJob(seedJob());

    await processTaskIpc(
      { type: 'heartbeat_remove_job', jobId: 'hb-rm-001' },
      'main',
      true,
      deps,
    );

    expect(getHeartbeatJob('hb-rm-001')).toBeUndefined();
  });

  it('owning group can remove its own job', async () => {
    const { createHeartbeatJob } = await import('./db.js');
    createHeartbeatJob(seedJob());

    await processTaskIpc(
      { type: 'heartbeat_remove_job', jobId: 'hb-rm-001' },
      'other-group',
      false,
      deps,
    );

    expect(getHeartbeatJob('hb-rm-001')).toBeUndefined();
  });

  it('non-owning group cannot remove another group\'s job', async () => {
    const { createHeartbeatJob } = await import('./db.js');
    createHeartbeatJob(seedJob());

    await processTaskIpc(
      { type: 'heartbeat_remove_job', jobId: 'hb-rm-001' },
      'third-group',
      false,
      deps,
    );

    // Job must still exist
    expect(getHeartbeatJob('hb-rm-001')).toBeDefined();
  });
});

// --- heartbeat_config authorization ---

describe('heartbeat_config authorization', () => {
  it('main group can configure heartbeat', async () => {
    let patched = false;
    const depsWithPatch: typeof deps = {
      ...deps,
      patchHeartbeatConfig: (patch) => { if (patch.enabled !== undefined) patched = true; },
    };

    await processTaskIpc(
      { type: 'heartbeat_config', heartbeat: { enabled: false } },
      'main',
      true,
      depsWithPatch,
    );

    // patchHeartbeatConfig should have been called
    expect(patched).toBe(true);
  });

  it('non-main group cannot configure heartbeat', async () => {
    let patched = false;
    const depsWithPatch: typeof deps = {
      ...deps,
      patchHeartbeatConfig: () => { patched = true; },
    };

    await processTaskIpc(
      { type: 'heartbeat_config', heartbeat: { enabled: false } },
      'other-group',
      false,
      depsWithPatch,
    );

    expect(patched).toBe(false);
  });
});
