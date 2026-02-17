import { ASSISTANT_NAME, MAX_PROMPT_CHARS } from './config.js';
import { Channel, NewMessage } from './types.js';

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatMessages(messages: NewMessage[], maxChars: number = MAX_PROMPT_CHARS): string {
  const lines = messages.map((m) =>
    `<message sender="${escapeXml(m.sender_name)}" time="${m.timestamp}">${escapeXml(m.content)}</message>`,
  );

  // If total size is within budget, return as-is
  let total = lines.reduce((sum, l) => sum + l.length, 0);

  if (total <= maxChars) {
    return `<messages>\n${lines.join('\n')}\n</messages>`;
  }

  // Over budget: drop oldest messages until we fit
  let dropped = 0;
  while (lines.length > 1 && total > maxChars) {
    total -= lines[0].length;
    lines.shift();
    dropped++;
  }

  const header = `<!-- ${dropped} earlier message(s) truncated to fit context budget -->`;
  return `<messages>\n${header}\n${lines.join('\n')}\n</messages>`;
}

export function stripInternalTags(text: string): string {
  return text.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
}

export function formatOutbound(channel: Channel, rawText: string): string {
  const text = stripInternalTags(rawText);
  if (!text) return '';
  const prefix =
    channel.prefixAssistantName !== false ? `${ASSISTANT_NAME}: ` : '';
  return `${prefix}${text}`;
}

export function routeOutbound(
  channels: Channel[],
  jid: string,
  text: string,
): Promise<void> {
  const channel = channels.find((c) => c.ownsJid(jid) && c.isConnected());
  if (!channel) throw new Error(`No channel for JID: ${jid}`);
  return channel.sendMessage(jid, text);
}

export function findChannel(
  channels: Channel[],
  jid: string,
): Channel | undefined {
  return channels.find((c) => c.ownsJid(jid));
}
