/**
 * Oracle v2 Type Definitions
 * Following claude-mem patterns for granular vector documents
 */

export type OracleDocumentType = 'principle' | 'pattern' | 'learning' | 'retro';

/**
 * Memory layer classification (v0.7.0 Phase 4)
 * Five-Layer Memory System ตาม cognitive memory model
 *
 * - user_model:  Layer 1 — ข้อมูลเกี่ยวกับ user (preferences, expertise, style) ★ ไม่ decay
 * - procedural:  Layer 2 — "วิธีทำงาน" ที่เรียนรู้จาก corrections/patterns ★ decay ช้า
 * - semantic:    Layer 3 — knowledge base เดิม (principle/pattern/learning/retro) ★ decay ปกติ
 * - episodic:    Layer 4 — conversation summaries, interaction records ★ มี TTL
 * - (working):   Layer 5 — อยู่ใน container context ตามธรรมชาติ ไม่เก็บใน DB
 *
 * null (legacy documents) → treated as 'semantic' implicitly
 */
export type MemoryLayer = 'user_model' | 'procedural' | 'semantic' | 'episodic';

/**
 * Granular document stored in vector DB
 * Following claude-mem's pattern of splitting large documents into smaller chunks
 */
export interface OracleDocument {
  id: string;           // e.g., "resonance_oracle_principle_1"
  type: OracleDocumentType;
  source_file: string;  // Relative path from repo root
  content: string;      // The actual text to embed
  concepts: string[];   // Tags for filtering: ['trust', 'patterns', 'mirror']
  created_at: number;   // Unix timestamp
  updated_at: number;   // Unix timestamp
  project?: string;     // Source project (from frontmatter or repo detection)
  is_private?: boolean; // true=private layer (not in git), false/undefined=public
  // Chunk metadata (v0.6.0 Part C)
  chunk_index?: number;   // Chunk number within parent (0-indexed)
  total_chunks?: number;  // Total chunks parent was split into
  parent_id?: string;     // ID of the parent document (before chunking)
  // Memory layer system (v0.7.0 Phase 4)
  memory_layer?: MemoryLayer;  // null = legacy → treated as 'semantic'
  confidence?: number;         // 0.0-1.0 ความมั่นใจในข้อมูล
  access_count?: number;       // จำนวนครั้งที่ถูก search hit
  last_accessed_at?: number;   // Unix timestamp ms ครั้งล่าสุดถูกเข้าถึง
  decay_score?: number;        // 0.0-1.0 (1.0=fresh, 0.0=stale)
  expires_at?: number;         // TTL timestamp ms (null=never expire)
}

/**
 * Metadata stored in SQLite (source of truth)
 */
export interface OracleMetadata {
  id: string;
  type: OracleDocumentType;
  source_file: string;
  concepts: string;     // JSON array as string
  created_at: number;
  updated_at: number;
  indexed_at: number;   // When this was indexed
}

/**
 * Search result from hybrid search
 */
export interface SearchResult {
  document: OracleDocument;
  score: number;        // Relevance score from vector search
  source: 'vector' | 'fts' | 'hybrid';
}

/**
 * Tool input schemas
 */
export interface OracleSearchInput {
  query: string;
  type?: OracleDocumentType | 'all';
  limit?: number;
}

export interface OracleConsultInput {
  decision: string;
  context?: string;
}

export interface OracleReflectInput {
  // No parameters - returns random wisdom
}

/**
 * oracle_list input - browse documents without search query
 */
export interface OracleListInput {
  type?: OracleDocumentType | 'all';
  limit?: number;
  offset?: number;
}

/**
 * Tool output types
 */
export interface OracleSearchOutput {
  results: SearchResult[];
  total: number;
}

export interface OracleConsultOutput {
  principles: SearchResult[];
  patterns: SearchResult[];
  guidance: string;
}

export interface OracleReflectOutput {
  principle: OracleDocument;
}

/**
 * oracle_list output - paginated document list
 */
export interface OracleListOutput {
  documents: Array<{
    id: string;
    type: OracleDocumentType;
    title: string;
    content: string;
    source_file: string;
    concepts: string[];
    indexed_at: number;
  }>;
  total: number;
  limit: number;
  offset: number;
  type: string;
}

/**
 * Hybrid search options for combining FTS and vector results
 */
export interface HybridSearchOptions {
  ftsWeight?: number;     // Weight for FTS results (default 0.5)
  vectorWeight?: number;  // Weight for vector results (default 0.5)
}

/**
 * Indexer configuration
 */
export interface IndexerConfig {
  repoRoot: string;
  dbPath: string;
  chromaPath: string;
  sourcePaths: {
    resonance: string;
    learnings: string;
    retrospectives: string;
  };
}

// ============================================================================
// v0.7.0 Phase 4 — Five-Layer Memory Types
// ============================================================================

/**
 * User Model (Layer 1) — ข้อมูลเกี่ยวกับ user
 * ถูกดึงเข้า system prompt ทุก request เพื่อ personalize response
 *
 * Storage: 1 document per user ใน oracle_documents
 *   id = 'user_model_{userId}'
 *   memory_layer = 'user_model'
 *   type = 'learning'
 *   is_private = 1
 */
export interface UserModel {
  userId: string;
  expertise: Record<string, 'novice' | 'intermediate' | 'advanced' | 'expert'>;
  preferences: {
    language: 'th' | 'en' | 'mixed';
    responseLength: 'concise' | 'detailed' | 'auto';
    responseStyle: 'formal' | 'casual' | 'auto';
    codeStyle?: string;  // e.g., 'functional', 'oop'
  };
  commonTopics: string[];
  timezone: string;
  activeHours?: { start: number; end: number };
  notes: string[];  // free-form personality/compatibility notes
  updatedAt: number;
}

/** Expertise level type */
export type ExpertiseLevel = 'novice' | 'intermediate' | 'advanced' | 'expert';

/**
 * Procedural Memory (Layer 2) — "วิธีทำงาน" ที่ AI เรียนรู้
 * เรียนรู้จาก corrections, repeated success patterns, explicit teaching
 *
 * Storage: 1 document per procedure ใน oracle_documents
 *   id = 'procedural_{hash(trigger)}'
 *   memory_layer = 'procedural'
 *   type = 'pattern'
 */
export interface ProceduralMemory {
  trigger: string;        // "เมื่อ user ถาม deploy" — เงื่อนไขที่จะ activate
  procedure: string[];    // ["แสดง checklist ก่อน", "ถามเรื่อง environment"]
  source: 'correction' | 'repeated_pattern' | 'explicit';
  successCount: number;
  lastUsed: number;       // Unix timestamp ms
}

/**
 * Episodic Memory (Layer 4) — summarized conversation episodes
 *
 * Storage: 1 document per episode ใน oracle_documents
 *   id = 'episodic_{groupId}_{timestamp}'
 *   memory_layer = 'episodic'
 *   type = 'retro'
 *   expires_at = created_at + 90 days
 */
export interface EpisodicMemory {
  userId: string;
  groupId: string;
  summary: string;
  topics: string[];
  outcome: 'success' | 'partial' | 'failed' | 'unknown';
  durationMs: number;
  recordedAt: number;  // Unix timestamp ms
}

/**
 * Default User Model — สร้างอัตโนมัติเมื่อไม่มี
 */
export const DEFAULT_USER_MODEL: Omit<UserModel, 'userId'> = {
  expertise: {},
  preferences: {
    language: 'th',
    responseLength: 'auto',
    responseStyle: 'casual',
  },
  commonTopics: [],
  timezone: 'Asia/Bangkok',
  notes: [],
  updatedAt: 0,
};

/**
 * Helper: get effective memory layer (null → 'semantic')
 */
export function getEffectiveLayer(layer: MemoryLayer | null | undefined): MemoryLayer {
  return layer ?? 'semantic';
}

/**
 * Helper: convert DB integer (0-100) to float (0.0-1.0)
 */
export function intToFloat(value: number | null | undefined): number {
  if (value == null) return 1.0;
  return value / 100;
}

/**
 * Helper: convert float (0.0-1.0) to DB integer (0-100)
 */
export function floatToInt(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 100);
}
