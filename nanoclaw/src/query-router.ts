/**
 * Smart Query Router — Classify messages to optimal handler tier
 *
 * Tiers:
 *   inline         — Greetings, thanks, acks → template reply (<50ms)
 *   oracle-only    — Knowledge recall/search → Oracle API (<500ms)
 *   container-light — Simple questions → Haiku model (<5s)
 *   container-full  — Code/analysis/complex → Sonnet/Opus (<15s)
 */

export type QueryTier = 'inline' | 'oracle-only' | 'container-light' | 'container-full';

export interface QueryClassification {
  tier: QueryTier;
  model: 'haiku' | 'sonnet' | 'opus';
  reason: string;
}

// --- Pattern matchers ---

const GREETING = /^(สวัสดี|หวัดดี|hello|hi|hey|ดี|yo|อรุณสวัสดิ์|ราตรีสวัสดิ์)\b/i;
const THANKS = /^(ขอบคุณ|thanks|thank you|thx|ขอบใจ|ty)\b/i;
const ACK = /^(ok|ได้|โอเค|ค่ะ|ครับ|รับทราบ|เข้าใจ|เข้าใจแล้ว|okey|okay|noted|understood|sure|yep|nope|ใช่|ไม่|yes|no)\s*[.!]*$/i;
const ADMIN_CMD = /^\/(start|help|status|soul|me|reset)\b/i;

const SEARCH_QUERY = /^(หา|ค้นหา|search|find|ค้น)\s+/i;
const MEMORY_STORE = /^(จำไว้|remember|จำว่า|note|บันทึก)\s+/i;
const MEMORY_RECALL = /^(รู้อะไร|จำได้|เคยคุย|เมื่อวาน|ก่อนหน้า|what do you know|remember when|last time)/i;

const CODE_MARKERS = /```|`[^`]+`|เขียนโค้ด|write code|debug|fix bug|function|class |import |def |const |let |var |สร้างไฟล์|create file|แก้ไฟล์|edit file/i;
const ANALYSIS_MARKERS = /วิเคราะห์|analyze|เปรียบเทียบ|compare|review|สรุป.*ยาว|deep dive|in depth|อธิบาย.*ละเอียด/i;

/**
 * Classify a message into the appropriate processing tier
 */
export function classifyQuery(message: string): QueryClassification {
  const trimmed = message.trim();
  const len = trimmed.length;

  // Tier 1: Inline — trivial messages
  if (GREETING.test(trimmed)) {
    return { tier: 'inline', model: 'haiku', reason: 'greeting' };
  }
  if (THANKS.test(trimmed)) {
    return { tier: 'inline', model: 'haiku', reason: 'thanks' };
  }
  if (ACK.test(trimmed)) {
    return { tier: 'inline', model: 'haiku', reason: 'ack' };
  }
  if (ADMIN_CMD.test(trimmed)) {
    return { tier: 'inline', model: 'haiku', reason: 'admin-cmd' };
  }

  // Tier 2: Oracle-only — knowledge queries
  if (SEARCH_QUERY.test(trimmed)) {
    return { tier: 'oracle-only', model: 'haiku', reason: 'search' };
  }
  if (MEMORY_STORE.test(trimmed)) {
    return { tier: 'oracle-only', model: 'haiku', reason: 'memory-store' };
  }
  if (MEMORY_RECALL.test(trimmed)) {
    return { tier: 'oracle-only', model: 'haiku', reason: 'memory-recall' };
  }

  // Tier 4: Container-full — code/analysis/complex
  if (CODE_MARKERS.test(trimmed)) {
    return { tier: 'container-full', model: 'sonnet', reason: 'code' };
  }
  if (ANALYSIS_MARKERS.test(trimmed)) {
    return { tier: 'container-full', model: 'sonnet', reason: 'analysis' };
  }
  if (len > 500) {
    return { tier: 'container-full', model: 'sonnet', reason: 'long-message' };
  }

  // Tier 3: Container-light — general questions
  return { tier: 'container-light', model: 'haiku', reason: 'general' };
}
