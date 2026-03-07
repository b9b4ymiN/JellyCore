/**
 * Oracle Handler — Knowledge queries without container spawn
 *
 * Calls Oracle V2 HTTP API directly. <500ms response time.
 */

import { logger } from './logger.js';
import { attachRequestIdHeader, createRequestId } from './request-id.js';

const ORACLE_URL = process.env.ORACLE_API_URL || 'http://localhost:47778';
const ORACLE_TOKEN = process.env.ORACLE_AUTH_TOKEN || '';

async function oracleFetch(path: string, requestId: string, options?: RequestInit): Promise<any> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (ORACLE_TOKEN) headers.Authorization = `Bearer ${ORACLE_TOKEN}`;
  const mergedHeaders = attachRequestIdHeader(headers, requestId);
  if (options?.headers && typeof options.headers === 'object' && !Array.isArray(options.headers)) {
    Object.assign(mergedHeaders, options.headers as Record<string, string>);
  }

  const resp = await fetch(`${ORACLE_URL}${path}`, { ...options, headers: mergedHeaders });
  if (!resp.ok) {
    throw new Error(`Oracle ${path}: ${resp.status}`);
  }
  return resp.json();
}

/**
 * Handle oracle-only queries: search, memory store, memory recall
 */
export async function handleOracleOnly(
  reason: string,
  message: string,
  requestId: string = createRequestId('oracle'),
): Promise<string> {
  try {
    if (reason === 'search') {
      const query = message.replace(/^(หา|ค้นหา|search|find|ค้น)\s+/i, '').trim();
      const data = await oracleFetch(`/api/search?q=${encodeURIComponent(query)}&limit=5`, requestId);
      if (!data.results || data.results.length === 0) {
        return `🔍 ไม่พบผลลัพธ์สำหรับ "${query}"`;
      }
      const items = data.results.slice(0, 3).map((r: any, i: number) =>
        `${i + 1}. **${r.type}** — ${r.content.substring(0, 150)}...`
      );
      return `🔍 ผลค้นหา "${query}":\n\n${items.join('\n')}`;
    }

    if (reason === 'memory-store') {
      const pattern = message.replace(/^(จำไว้|remember|จำว่า|note|บันทึก)\s+/i, '').trim();
      await oracleFetch('/api/learn', requestId, {
        method: 'POST',
        body: JSON.stringify({ pattern, source: 'whatsapp-direct' }),
      });
      return '✅ จำไว้แล้วครับ';
    }

    if (reason === 'memory-recall') {
      const query = message.trim();
      const data = await oracleFetch(`/api/search?q=${encodeURIComponent(query)}&limit=3`, requestId);
      if (!data.results || data.results.length === 0) {
        return '🤔 ไม่มีข้อมูลที่เกี่ยวข้องในความทรงจำครับ';
      }
      const items = data.results.slice(0, 3).map((r: any, i: number) =>
        `${i + 1}. ${r.content.substring(0, 200)}`
      );
      return `💭 ที่จำได้:\n\n${items.join('\n\n')}`;
    }

    // Generic consult
    const data = await oracleFetch(`/api/consult?q=${encodeURIComponent(message.trim())}`, requestId);
    return data.guidance || data.answer || '🤔 ไม่แน่ใจครับ';
  } catch (err) {
    // If Oracle is unavailable, fall through to container
    logger.warn({ err, reason, requestId }, 'Oracle-only handler failed');
    return '';
  }
}
