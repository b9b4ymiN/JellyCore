import type { NewMessage, RegisteredGroup } from './types.js';

const WORKING_SUMMARY_MESSAGES = 4;
const WORKING_SUMMARY_ITEM_LIMIT = 160;
const WORKING_SUMMARY_TOTAL_LIMIT = 500;

function truncateText(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

export function buildWorkingSummary(
  messages: NewMessage[],
  assistantName: string,
): string {
  const recent = messages.slice(-WORKING_SUMMARY_MESSAGES);
  const lines = recent
    .map((msg) => {
      const role = msg.is_from_me || msg.sender_name === assistantName ? 'assistant' : 'user';
      const compact = msg.content.replace(/\s+/g, ' ').trim();
      if (!compact) return '';
      return `${role}: ${truncateText(compact, WORKING_SUMMARY_ITEM_LIMIT)}`;
    })
    .filter(Boolean);

  if (lines.length === 0) return '';
  return truncateText(lines.join(' | '), WORKING_SUMMARY_TOTAL_LIMIT);
}

export function resolveChatTarget(
  registeredGroups: Record<string, RegisteredGroup>,
  mainGroupFolder: string,
  groupFolder?: string,
): {
  chatJid: string;
  group: RegisteredGroup;
} | null {
  if (groupFolder) {
    const matched = Object.entries(registeredGroups).find(([, g]) => g.folder === groupFolder);
    if (matched) {
      return { chatJid: matched[0], group: matched[1] };
    }
  }

  const main = Object.entries(registeredGroups).find(([, g]) => g.folder === mainGroupFolder);
  if (main) {
    return { chatJid: main[0], group: main[1] };
  }

  const first = Object.entries(registeredGroups)[0];
  if (!first) return null;
  return { chatJid: first[0], group: first[1] };
}

export interface ChatHistoryRow {
  id: string;
  sender: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me: number;
}

export function mapWebHistoryRows(
  rows: ChatHistoryRow[],
  assistantName: string,
): Array<{
  id: string;
  sender: string;
  senderName: string;
  content: string;
  timestamp: string;
  isFromMe: boolean;
  role: 'user' | 'assistant' | 'system';
}> {
  return rows.map((row) => {
    const senderName = row.sender_name || '';
    const senderLower = senderName.toLowerCase();
    const isAssistant = senderName === assistantName || (row.is_from_me === 1 && senderName !== 'Web');
    const isSystem = senderLower === 'system' || senderLower === 'sys';
    const role: 'user' | 'assistant' | 'system' = isSystem ? 'system' : isAssistant ? 'assistant' : 'user';

    return {
      id: row.id,
      sender: row.sender,
      senderName,
      content: row.content,
      timestamp: row.timestamp,
      isFromMe: row.is_from_me === 1,
      role,
    };
  });
}
