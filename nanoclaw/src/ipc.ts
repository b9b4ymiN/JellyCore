import fs from 'fs';
import path from 'path';

import { CronExpressionParser } from 'cron-parser';

import {
  ASSISTANT_NAME,
  DATA_DIR,
  IPC_POLL_INTERVAL,
  IPC_SECRET,
  MAIN_GROUP_FOLDER,
  TIMEZONE,
} from './config.js';
import { AvailableGroup } from './container-runner.js';
import { createTask, cancelTask, getTaskById, updateTask, findDuplicateTask, createHeartbeatJob, getHeartbeatJob, getAllHeartbeatJobs, updateHeartbeatJob, deleteHeartbeatJob } from './db.js';
import { verifyIpcMessage } from './ipc-signing.js';
import { logger } from './logger.js';
import { RegisteredGroup, HeartbeatJob } from './types.js';

export interface IpcDeps {
  sendMessage: (jid: string, text: string) => Promise<void>;
  registeredGroups: () => Record<string, RegisteredGroup>;
  registerGroup: (jid: string, group: RegisteredGroup) => void;
  syncGroupMetadata: (force: boolean) => Promise<void>;
  getAvailableGroups: () => AvailableGroup[];
  writeGroupsSnapshot: (
    groupFolder: string,
    isMain: boolean,
    availableGroups: AvailableGroup[],
    registeredJids: Set<string>,
  ) => void;
  /** Forward heartbeat config patch (from heartbeat_config IPC command) */
  patchHeartbeatConfig?: (patch: Record<string, unknown>) => void;
  /** Trigger an immediate task run by setting next_run = now */
  runTaskNow?: (taskId: string) => void;
}

let ipcWatcherRunning = false;

export function startIpcWatcher(deps: IpcDeps): void {
  if (ipcWatcherRunning) {
    logger.debug('IPC watcher already running, skipping duplicate start');
    return;
  }
  ipcWatcherRunning = true;

  const ipcBaseDir = path.join(DATA_DIR, 'ipc');
  fs.mkdirSync(ipcBaseDir, { recursive: true });

  const IPC_FALLBACK_INTERVAL = 30000; // Fallback poll every 30s (fs.watch is primary)

  const processIpcFiles = async () => {
    // Scan all group IPC directories (identity determined by directory)
    let groupFolders: string[];
    try {
      groupFolders = fs.readdirSync(ipcBaseDir).filter((f) => {
        const stat = fs.statSync(path.join(ipcBaseDir, f));
        return stat.isDirectory() && f !== 'errors';
      });
    } catch (err) {
      logger.error({ err }, 'Error reading IPC base directory');
      return;
    }

    const registeredGroups = deps.registeredGroups();

    for (const sourceGroup of groupFolders) {
      const isMain = sourceGroup === MAIN_GROUP_FOLDER;
      const messagesDir = path.join(ipcBaseDir, sourceGroup, 'messages');
      const tasksDir = path.join(ipcBaseDir, sourceGroup, 'tasks');

      // Process messages from this group's IPC directory
      try {
        if (fs.existsSync(messagesDir)) {
          const messageFiles = fs
            .readdirSync(messagesDir)
            .filter((f) => f.endsWith('.json'));
          for (const file of messageFiles) {
            const filePath = path.join(messagesDir, file);
            try {
              const raw = fs.readFileSync(filePath, 'utf-8');
              const { valid, data } = verifyIpcMessage(raw, IPC_SECRET);
              if (!valid) {
                logger.warn({ file, sourceGroup }, 'IPC message rejected: invalid HMAC signature');
                fs.unlinkSync(filePath);
                continue;
              }
              if (data!.type === 'message' && data!.chatJid && data!.text) {
                // Authorization: verify this group can send to this chatJid
                const targetGroup = registeredGroups[data!.chatJid as string];
                if (
                  isMain ||
                  (targetGroup && targetGroup.folder === sourceGroup)
                ) {
                  await deps.sendMessage(
                    data!.chatJid as string,
                    `${ASSISTANT_NAME}: ${data!.text}`,
                  );
                  logger.info(
                    { chatJid: data!.chatJid, sourceGroup },
                    'IPC message sent',
                  );
                } else {
                  logger.warn(
                    { chatJid: data!.chatJid, sourceGroup },
                    'Unauthorized IPC message attempt blocked',
                  );
                }
              }
              fs.unlinkSync(filePath);
            } catch (err) {
              logger.error(
                { file, sourceGroup, err },
                'Error processing IPC message',
              );
              const errorDir = path.join(ipcBaseDir, 'errors');
              fs.mkdirSync(errorDir, { recursive: true });
              fs.renameSync(
                filePath,
                path.join(errorDir, `${sourceGroup}-${file}`),
              );
            }
          }
        }
      } catch (err) {
        logger.error(
          { err, sourceGroup },
          'Error reading IPC messages directory',
        );
      }

      // Process tasks from this group's IPC directory
      try {
        if (fs.existsSync(tasksDir)) {
          const taskFiles = fs
            .readdirSync(tasksDir)
            .filter((f) => f.endsWith('.json'));
          for (const file of taskFiles) {
            const filePath = path.join(tasksDir, file);
            try {
              const raw = fs.readFileSync(filePath, 'utf-8');
              const { valid, data } = verifyIpcMessage(raw, IPC_SECRET);
              if (!valid) {
                logger.warn({ file, sourceGroup }, 'IPC task rejected: invalid HMAC signature');
                fs.unlinkSync(filePath);
                continue;
              }
              // Pass source group identity to processTaskIpc for authorization
              await processTaskIpc(data as any, sourceGroup, isMain, deps);
              fs.unlinkSync(filePath);
            } catch (err) {
              logger.error(
                { file, sourceGroup, err },
                'Error processing IPC task',
              );
              const errorDir = path.join(ipcBaseDir, 'errors');
              fs.mkdirSync(errorDir, { recursive: true });
              fs.renameSync(
                filePath,
                path.join(errorDir, `${sourceGroup}-${file}`),
              );
            }
          }
        }
      } catch (err) {
        logger.error({ err, sourceGroup }, 'Error reading IPC tasks directory');
      }
    }

    // Fallback poll runs on a longer interval; fs.watch handles immediate events
  };

  // Primary: fs.watch for immediate event detection
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  try {
    fs.watch(ipcBaseDir, { recursive: true }, (eventType, filename) => {
      if (!filename || !filename.endsWith('.json')) return;
      // Debounce 100ms to batch rapid file creation events
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        processIpcFiles().catch(err => logger.error({ err }, 'Error in fs.watch IPC handler'));
      }, 100);
    });
    logger.info('IPC watcher started (fs.watch + 30s fallback)');
  } catch (err) {
    logger.warn({ err }, 'fs.watch unavailable, using polling only');
  }

  // Fallback: poll at reduced interval to catch any missed events
  const fallbackPoll = async () => {
    await processIpcFiles();
    setTimeout(fallbackPoll, IPC_FALLBACK_INTERVAL);
  };
  fallbackPoll();
}

export async function processTaskIpc(
  data: {
    type: string;
    taskId?: string;
    prompt?: string;
    schedule_type?: string;
    schedule_value?: string;
    context_mode?: string;
    groupFolder?: string;
    chatJid?: string;
    targetJid?: string;
    // For register_group
    jid?: string;
    name?: string;
    folder?: string;
    trigger?: string;
    requiresTrigger?: boolean;
    containerConfig?: RegisteredGroup['containerConfig'];
    // For heartbeat_config
    heartbeat?: Record<string, unknown>;
    // For update_task / schedule_task metadata
    label?: string;
    max_retries?: number;
    retry_delay_ms?: number;
    task_timeout_ms?: number | null;
    // For heartbeat job commands
    jobId?: string;
    category?: string;
    interval_ms?: number | null;
    status?: string;
  },
  sourceGroup: string, // Verified identity from IPC directory
  isMain: boolean, // Verified from directory path
  deps: IpcDeps,
): Promise<void> {
  const registeredGroups = deps.registeredGroups();

  switch (data.type) {
    case 'schedule_task':
      if (
        data.prompt &&
        data.schedule_type &&
        data.schedule_value &&
        data.targetJid
      ) {
        // Resolve the target group from JID
        const targetJid = data.targetJid as string;
        const targetGroupEntry = registeredGroups[targetJid];

        if (!targetGroupEntry) {
          logger.warn(
            { targetJid },
            'Cannot schedule task: target group not registered',
          );
          break;
        }

        const targetFolder = targetGroupEntry.folder;

        // Authorization: non-main groups can only schedule for themselves
        if (!isMain && targetFolder !== sourceGroup) {
          logger.warn(
            { sourceGroup, targetFolder },
            'Unauthorized schedule_task attempt blocked',
          );
          break;
        }

        const scheduleType = data.schedule_type as 'cron' | 'interval' | 'once';

        let nextRun: string | null = null;
        if (scheduleType === 'cron') {
          try {
            const interval = CronExpressionParser.parse(data.schedule_value, {
              tz: TIMEZONE,
            });
            nextRun = interval.next().toISOString();
          } catch {
            logger.warn(
              { scheduleValue: data.schedule_value },
              'Invalid cron expression',
            );
            break;
          }
        } else if (scheduleType === 'interval') {
          const ms = parseInt(data.schedule_value, 10);
          if (isNaN(ms) || ms <= 0) {
            logger.warn(
              { scheduleValue: data.schedule_value },
              'Invalid interval',
            );
            break;
          }
          nextRun = new Date(Date.now() + ms).toISOString();
        } else if (scheduleType === 'once') {
          const scheduled = new Date(data.schedule_value);
          if (isNaN(scheduled.getTime())) {
            logger.warn(
              { scheduleValue: data.schedule_value },
              'Invalid timestamp',
            );
            break;
          }
          nextRun = scheduled.toISOString();
        }

        const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const contextMode =
          data.context_mode === 'group' || data.context_mode === 'isolated'
            ? data.context_mode
            : 'isolated';

        // Duplicate guard: block semantically identical tasks
        const existing = findDuplicateTask(targetFolder, data.schedule_value, data.prompt);
        if (existing) {
          logger.warn(
            { existingId: existing.id, targetFolder, scheduleValue: data.schedule_value },
            'Duplicate task blocked (same group/schedule/prompt already active)',
          );
          break;
        }

        createTask({
          id: taskId,
          group_folder: targetFolder,
          chat_jid: targetJid,
          prompt: data.prompt,
          schedule_type: scheduleType,
          schedule_value: data.schedule_value,
          context_mode: contextMode,
          next_run: nextRun,
          status: 'active',
          created_at: new Date().toISOString(),
          retry_count: 0,
          max_retries: data.max_retries ?? 0,
          retry_delay_ms: data.retry_delay_ms ?? 300000,
          task_timeout_ms: data.task_timeout_ms ?? null,
          label: data.label ?? null,
        });
        logger.info(
          { taskId, sourceGroup, targetFolder, contextMode },
          'Task created via IPC',
        );
      }
      break;

    case 'pause_task':
      if (data.taskId) {
        const task = getTaskById(data.taskId);
        if (task && (isMain || task.group_folder === sourceGroup)) {
          updateTask(data.taskId, { status: 'paused' });
          logger.info(
            { taskId: data.taskId, sourceGroup },
            'Task paused via IPC',
          );
        } else {
          logger.warn(
            { taskId: data.taskId, sourceGroup },
            'Unauthorized task pause attempt',
          );
        }
      }
      break;

    case 'resume_task':
      if (data.taskId) {
        const task = getTaskById(data.taskId);
        if (task && (isMain || task.group_folder === sourceGroup)) {
          updateTask(data.taskId, { status: 'active' });
          logger.info(
            { taskId: data.taskId, sourceGroup },
            'Task resumed via IPC',
          );
        } else {
          logger.warn(
            { taskId: data.taskId, sourceGroup },
            'Unauthorized task resume attempt',
          );
        }
      }
      break;

    case 'cancel_task':
      if (data.taskId) {
        const task = getTaskById(data.taskId);
        if (task && (isMain || task.group_folder === sourceGroup)) {
          cancelTask(data.taskId); // soft-delete: preserves audit trail
          logger.info(
            { taskId: data.taskId, sourceGroup },
            'Task cancelled via IPC',
          );
        } else {
          logger.warn(
            { taskId: data.taskId, sourceGroup },
            'Unauthorized task cancel attempt',
          );
        }
      }
      break;

    case 'run_task_now':
      if (data.taskId) {
        const task = getTaskById(data.taskId);
        if (task && (isMain || task.group_folder === sourceGroup)) {
          if (task.status !== 'active') {
            logger.warn({ taskId: data.taskId }, 'run_task_now: task is not active');
            break;
          }
          if (deps.runTaskNow) {
            deps.runTaskNow(data.taskId);
          } else {
            updateTask(data.taskId, { next_run: new Date().toISOString() });
          }
          logger.info({ taskId: data.taskId, sourceGroup }, 'Task triggered via run_task_now');
        } else {
          logger.warn({ taskId: data.taskId, sourceGroup }, 'Unauthorized run_task_now attempt');
        }
      }
      break;

    case 'update_task':
      if (data.taskId) {
        const task = getTaskById(data.taskId);
        if (task && (isMain || task.group_folder === sourceGroup)) {
          const patch: Parameters<typeof updateTask>[1] = {};
          if (data.prompt !== undefined) patch.prompt = data.prompt;
          if (data.schedule_type) patch.schedule_type = data.schedule_type as 'cron' | 'interval' | 'once';
          if (data.schedule_value) {
            patch.schedule_value = data.schedule_value;
            // Recalculate next_run when cron schedule changes
            const newSched = data.schedule_type ?? task.schedule_type;
            if (newSched === 'cron') {
              try {
                const interval = CronExpressionParser.parse(data.schedule_value, { tz: TIMEZONE });
                patch.next_run = interval.next().toISOString();
              } catch {
                logger.warn({ scheduleValue: data.schedule_value }, 'update_task: invalid cron expression');
              }
            }
          }
          if (data.label !== undefined) patch.label = data.label;
          if (data.max_retries !== undefined) patch.max_retries = data.max_retries;
          if (data.retry_delay_ms !== undefined) patch.retry_delay_ms = data.retry_delay_ms;
          if (data.task_timeout_ms !== undefined) patch.task_timeout_ms = data.task_timeout_ms;
          updateTask(data.taskId, patch);
          logger.info({ taskId: data.taskId, patch, sourceGroup }, 'Task updated via IPC');
        } else {
          logger.warn({ taskId: data.taskId, sourceGroup }, 'Unauthorized update_task attempt');
        }
      }
      break;

    case 'heartbeat_config':
      if (isMain && data.heartbeat && deps.patchHeartbeatConfig) {
        deps.patchHeartbeatConfig(data.heartbeat);
        logger.info({ patch: data.heartbeat }, 'Heartbeat config updated via IPC');
      } else if (!isMain) {
        logger.warn({ sourceGroup }, 'Unauthorized heartbeat_config attempt (main group only)');
      }
      break;

    case 'refresh_groups':
      // Only main group can request a refresh
      if (isMain) {
        logger.info(
          { sourceGroup },
          'Group metadata refresh requested via IPC',
        );
        await deps.syncGroupMetadata(true);
        // Write updated snapshot immediately
        const availableGroups = deps.getAvailableGroups();
        deps.writeGroupsSnapshot(
          sourceGroup,
          true,
          availableGroups,
          new Set(Object.keys(registeredGroups)),
        );
      } else {
        logger.warn(
          { sourceGroup },
          'Unauthorized refresh_groups attempt blocked',
        );
      }
      break;

    case 'register_group':
      // Only main group can register new groups
      if (!isMain) {
        logger.warn(
          { sourceGroup },
          'Unauthorized register_group attempt blocked',
        );
        break;
      }
      if (data.jid && data.name && data.folder && data.trigger) {
        deps.registerGroup(data.jid, {
          name: data.name,
          folder: data.folder,
          trigger: data.trigger,
          added_at: new Date().toISOString(),
          containerConfig: data.containerConfig,
          requiresTrigger: data.requiresTrigger,
        });
      } else {
        logger.warn(
          { data },
          'Invalid register_group request - missing required fields',
        );
      }
      break;

    // ── Smart Heartbeat Job Commands ───────────────────────────────────────

    case 'heartbeat_add_job': {
      if (!data.label || !data.prompt || !data.category) {
        logger.warn({ data }, 'heartbeat_add_job: missing required fields');
        break;
      }
      const jobId = `hb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const chatJidForJob = data.chatJid || (
        Object.entries(registeredGroups).find(([, g]) => g.folder === sourceGroup)?.[0] ?? ''
      );
      createHeartbeatJob({
        id: jobId,
        chat_jid: chatJidForJob,
        label: data.label,
        prompt: data.prompt,
        category: data.category as 'learning' | 'monitor' | 'health' | 'custom',
        status: 'active',
        interval_ms: data.interval_ms ?? null,
        last_run: null,
        last_result: null,
        created_at: new Date().toISOString(),
        created_by: sourceGroup,
      });
      // Write snapshot for containers to read
      writeHeartbeatJobsSnapshot();
      logger.info(
        { jobId, label: data.label, category: data.category, sourceGroup },
        'Heartbeat job created via IPC',
      );
      break;
    }

    case 'heartbeat_update_job': {
      if (!data.jobId) {
        logger.warn({ data }, 'heartbeat_update_job: missing jobId');
        break;
      }
      // Resolve partial ID match
      const allJobs = getAllHeartbeatJobs();
      const matchingJob = allJobs.find(j => j.id === data.jobId || j.id.startsWith(data.jobId!));
      if (!matchingJob) {
        logger.warn({ jobId: data.jobId }, 'heartbeat_update_job: job not found');
        break;
      }
      // Non-main can only update own jobs
      if (!isMain && matchingJob.created_by !== sourceGroup) {
        logger.warn({ jobId: data.jobId, sourceGroup }, 'Unauthorized heartbeat_update_job attempt');
        break;
      }
      const patch: Partial<Pick<HeartbeatJob, 'label' | 'prompt' | 'category' | 'status' | 'interval_ms'>> = {};
      if (data.label !== undefined) patch.label = data.label;
      if (data.prompt !== undefined) patch.prompt = data.prompt;
      if (data.category !== undefined) patch.category = data.category as HeartbeatJob['category'];
      if (data.status !== undefined) patch.status = data.status as HeartbeatJob['status'];
      if (data.interval_ms !== undefined) patch.interval_ms = data.interval_ms;
      updateHeartbeatJob(matchingJob.id, patch);
      writeHeartbeatJobsSnapshot();
      logger.info({ jobId: matchingJob.id, patch, sourceGroup }, 'Heartbeat job updated via IPC');
      break;
    }

    case 'heartbeat_remove_job': {
      if (!data.jobId) {
        logger.warn({ data }, 'heartbeat_remove_job: missing jobId');
        break;
      }
      const allJobsForDelete = getAllHeartbeatJobs();
      const targetJob = allJobsForDelete.find(j => j.id === data.jobId || j.id.startsWith(data.jobId!));
      if (!targetJob) {
        logger.warn({ jobId: data.jobId }, 'heartbeat_remove_job: job not found');
        break;
      }
      if (!isMain && targetJob.created_by !== sourceGroup) {
        logger.warn({ jobId: data.jobId, sourceGroup }, 'Unauthorized heartbeat_remove_job attempt');
        break;
      }
      deleteHeartbeatJob(targetJob.id);
      writeHeartbeatJobsSnapshot();
      logger.info({ jobId: targetJob.id, sourceGroup }, 'Heartbeat job removed via IPC');
      break;
    }

    default:
      logger.warn({ type: data.type }, 'Unknown IPC task type');
  }
}

/**
 * Write current heartbeat jobs to a JSON snapshot for containers to read.
 */
export function writeHeartbeatJobsSnapshot(): void {
  const jobs = getAllHeartbeatJobs();
  const ipcBaseDir = path.join(DATA_DIR, 'ipc');
  const snapshotPath = path.join(ipcBaseDir, 'heartbeat_jobs.json');
  try {
    fs.mkdirSync(ipcBaseDir, { recursive: true });
    const tempPath = `${snapshotPath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(jobs, null, 2));
    fs.renameSync(tempPath, snapshotPath);
  } catch (err) {
    logger.warn({ err }, 'Failed to write heartbeat_jobs snapshot');
  }
}
