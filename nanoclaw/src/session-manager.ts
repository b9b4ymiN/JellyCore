import fs from 'fs';
import path from 'path';

import { DATA_DIR } from './config.js';
import {
  getAllChats,
  getAllRegisteredGroups,
  getAllSessions,
  getRouterState,
  setRegisteredGroup,
  setRouterState,
} from './db.js';
import { logger } from './logger.js';
import { recordNonFatalError } from './non-fatal-errors.js';
import type { AvailableGroup } from './container-runner.js';
import type { RegisteredGroup } from './types.js';

export interface SessionStateSnapshot {
  lastTimestamp: string;
  lastAgentTimestamp: Record<string, string>;
  sessions: Record<string, string>;
  registeredGroups: Record<string, RegisteredGroup>;
}

export function loadSessionState(): SessionStateSnapshot {
  const lastTimestamp = getRouterState('last_timestamp') || '';
  const agentTs = getRouterState('last_agent_timestamp');

  let lastAgentTimestamp: Record<string, string> = {};
  try {
    lastAgentTimestamp = agentTs ? JSON.parse(agentTs) : {};
  } catch (err) {
    recordNonFatalError(
      'state.last_agent_timestamp_parse_failed',
      err,
      { rawLength: agentTs?.length || 0 },
      'warn',
    );
    logger.warn('Corrupted last_agent_timestamp in DB, resetting');
  }

  const sessions = getAllSessions();
  const registeredGroups = getAllRegisteredGroups();
  logger.info({ groupCount: Object.keys(registeredGroups).length }, 'State loaded');

  return {
    lastTimestamp,
    lastAgentTimestamp,
    sessions,
    registeredGroups,
  };
}

export function saveRouterStateSnapshot(
  lastTimestamp: string,
  lastAgentTimestamp: Record<string, string>,
): void {
  setRouterState('last_timestamp', lastTimestamp);
  setRouterState('last_agent_timestamp', JSON.stringify(lastAgentTimestamp));
}

export function registerGroupState(
  registeredGroups: Record<string, RegisteredGroup>,
  jid: string,
  group: RegisteredGroup,
): void {
  registeredGroups[jid] = group;
  setRegisteredGroup(jid, group);

  const groupDir = path.join(DATA_DIR, '..', 'groups', group.folder);
  fs.mkdirSync(path.join(groupDir, 'logs'), { recursive: true });

  logger.info(
    { jid, name: group.name, folder: group.folder },
    'Group registered',
  );
}

export function listAvailableGroups(
  registeredGroups: Record<string, RegisteredGroup>,
): AvailableGroup[] {
  const chats = getAllChats();
  const registeredJids = new Set(Object.keys(registeredGroups));

  return chats
    .filter((c) => c.jid !== '__group_sync__' && c.jid.endsWith('@g.us'))
    .map((c) => ({
      jid: c.jid,
      name: c.name,
      lastActivity: c.last_message_time,
      isRegistered: registeredJids.has(c.jid),
    }));
}
