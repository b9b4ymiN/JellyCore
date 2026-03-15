/**
 * Knowledge Graph Service (P4)
 * 
 * Manages concept relationships and graph queries.
 * Tracks how concepts co-occur and relate to each other.
 * 
 * Features:
 * - Auto-discover relationships from document concepts
 * - Track relationship strength (co-occurrence frequency)
 * - Query related concepts
 * - Find paths between concepts
 */

import { eq, desc, and, or, sql, inArray, ne } from 'drizzle-orm';
import { db, sqlite } from './db/index.js';
import { conceptRelationships, oracleDocuments } from './db/schema.js';
import { logNonFatal } from './non-fatal.js';

export type RelationshipType = 'co-occurs' | 'related_to' | 'part_of' | 'prerequisite';
export type GraphHealthStatus = 'ready' | 'empty' | 'missing_table' | 'query_error';

const CO_OCCURS_RELATIONSHIP: RelationshipType = 'co-occurs';
const DISCOVERY_INSERT_BATCH_SIZE = 100;

export interface ConceptRelationship {
  id?: string;
  fromConcept: string;
  toConcept: string;
  relationshipType: RelationshipType;
  strength?: number;
  lastSeen?: number;
  createdAt?: number;
  metadata?: Record<string, any>;
}

export interface GraphDiscoveryResult {
  mode: 'rebuild';
  processed: number;
  attemptedPairs: number;
  relationships: number;
  skippedInvalidDocuments: number;
  skippedInsufficientConcepts: number;
  durationMs: number;
}

interface AggregatedRelationship {
  id: string;
  fromConcept: string;
  toConcept: string;
  relationshipType: RelationshipType;
  strength: number;
  lastSeen: number;
  createdAt: number;
  metadata: string | null;
}

export class GraphDiscoveryError extends Error {
  readonly result: GraphDiscoveryResult;
  readonly cause?: unknown;

  constructor(message: string, result: GraphDiscoveryResult, cause?: unknown) {
    super(message);
    this.name = 'GraphDiscoveryError';
    this.result = result;
    this.cause = cause;
  }
}

function makeCanonicalPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

function makeRelationshipKey(fromConcept: string, toConcept: string, relationshipType: RelationshipType): string {
  return `${fromConcept}|${toConcept}|${relationshipType}`;
}

function makeRelationshipId(fromConcept: string, toConcept: string, relationshipType: RelationshipType): string {
  return `rel_${fromConcept}_${toConcept}_${relationshipType}`;
}

function normalizeConcepts(rawConcepts: string): string[] | null {
  try {
    const parsed = JSON.parse(rawConcepts || '[]');
    if (!Array.isArray(parsed)) {
      return null;
    }

    const concepts = parsed
      .filter((concept): concept is string => typeof concept === 'string')
      .map((concept) => concept.trim())
      .filter(Boolean);

    return [...new Set(concepts)];
  } catch {
    return null;
  }
}

function chunkArray<T>(items: T[], batchSize: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += batchSize) {
    chunks.push(items.slice(index, index + batchSize));
  }
  return chunks;
}

export class KnowledgeGraphService {
  /**
   * Record a relationship between two concepts
   */
  async recordRelationship(rel: ConceptRelationship): Promise<void> {
    const now = Date.now();
    const [fromConcept, toConcept] =
      rel.relationshipType === CO_OCCURS_RELATIONSHIP
        ? makeCanonicalPair(rel.fromConcept, rel.toConcept)
        : [rel.fromConcept, rel.toConcept];
    const id = rel.id || makeRelationshipId(fromConcept, toConcept, rel.relationshipType);

    try {
      // Check if relationship exists
      const existing = db
        .select()
        .from(conceptRelationships)
        .where(
          and(
            eq(conceptRelationships.fromConcept, fromConcept),
            eq(conceptRelationships.toConcept, toConcept),
            eq(conceptRelationships.relationshipType, rel.relationshipType)
          )
        )
        .limit(1)
        .all();

      if (existing.length > 0) {
        // Update existing: increment strength
        db
          .update(conceptRelationships)
          .set({
            strength: sql`${conceptRelationships.strength} + 1`,
            lastSeen: now,
          })
          .where(eq(conceptRelationships.id, existing[0].id))
          .run();

        console.log(`[Graph] Updated relationship: ${fromConcept} -> ${toConcept}`);
      } else {
        // Insert new
        db.insert(conceptRelationships).values({
          id,
          fromConcept,
          toConcept,
          relationshipType: rel.relationshipType,
          strength: rel.strength || 1,
          lastSeen: now,
          createdAt: now,
          metadata: rel.metadata ? JSON.stringify(rel.metadata) : null,
        }).run();

        console.log(`[Graph] Created relationship: ${fromConcept} -> ${toConcept}`);
      }
    } catch (error) {
      logNonFatal('graph.record_relationship', error, { rel });
      throw error;
    }
  }

  /**
   * Discover relationships from all documents
   * Analyzes concept co-occurrence patterns
   */
  async discoverRelationships(): Promise<GraphDiscoveryResult> {
    console.log('[Graph] 🔍 Discovering relationships...');
    const startTime = Date.now();

    try {
      // Get all documents with concepts
      const docs = db
        .select({
          id: oracleDocuments.id,
          concepts: oracleDocuments.concepts,
        })
        .from(oracleDocuments)
        .all();

      const existingRelationships = db
        .select({
          fromConcept: conceptRelationships.fromConcept,
          toConcept: conceptRelationships.toConcept,
          relationshipType: conceptRelationships.relationshipType,
          createdAt: conceptRelationships.createdAt,
        })
        .from(conceptRelationships)
        .all();

      const existingCreatedAt = new Map<string, number>();
      for (const relationship of existingRelationships) {
        if (!relationship.fromConcept || !relationship.toConcept || !relationship.relationshipType) {
          continue;
        }

        const key =
          relationship.relationshipType === CO_OCCURS_RELATIONSHIP
            ? makeRelationshipKey(
                ...makeCanonicalPair(relationship.fromConcept, relationship.toConcept),
                CO_OCCURS_RELATIONSHIP,
              )
            : makeRelationshipKey(
                relationship.fromConcept,
                relationship.toConcept,
                relationship.relationshipType as RelationshipType,
              );

        existingCreatedAt.set(key, relationship.createdAt || startTime);
      }

      let attemptedPairs = 0;
      let skippedInvalidDocuments = 0;
      let skippedInsufficientConcepts = 0;
      const now = Date.now();
      const edgeMap = new Map<string, AggregatedRelationship>();

      for (const doc of docs) {
        const concepts = normalizeConcepts(doc.concepts || '[]');
        if (!concepts) {
          skippedInvalidDocuments += 1;
          continue;
        }

        if (concepts.length < 2) {
          skippedInsufficientConcepts += 1;
          continue;
        }

        for (let i = 0; i < concepts.length; i++) {
          for (let j = i + 1; j < concepts.length; j++) {
            const [fromConcept, toConcept] = makeCanonicalPair(concepts[i], concepts[j]);
            if (fromConcept === toConcept) {
              continue;
            }

            attemptedPairs += 1;
            const key = makeRelationshipKey(fromConcept, toConcept, CO_OCCURS_RELATIONSHIP);
            const existing = edgeMap.get(key);

            if (existing) {
              existing.strength += 1;
              continue;
            }

            edgeMap.set(key, {
              id: makeRelationshipId(fromConcept, toConcept, CO_OCCURS_RELATIONSHIP),
              fromConcept,
              toConcept,
              relationshipType: CO_OCCURS_RELATIONSHIP,
              strength: 1,
              lastSeen: now,
              createdAt: existingCreatedAt.get(key) ?? now,
              metadata: null,
            });
          }
        }
      }

      const relationships = [...edgeMap.values()];
      const result: GraphDiscoveryResult = {
        mode: 'rebuild',
        processed: docs.length,
        attemptedPairs,
        relationships: relationships.length,
        skippedInvalidDocuments,
        skippedInsufficientConcepts,
        durationMs: 0,
      };

      try {
        db.transaction((tx) => {
          tx.delete(conceptRelationships).run();

          for (const batch of chunkArray(relationships, DISCOVERY_INSERT_BATCH_SIZE)) {
            tx.insert(conceptRelationships).values(batch).run();
          }
        });
      } catch (error) {
        result.durationMs = Date.now() - startTime;
        logNonFatal('graph.discover_relationships', error, {
          processed: result.processed,
          attemptedPairs: result.attemptedPairs,
          relationships: result.relationships,
        });
        throw new GraphDiscoveryError('Relationship discovery failed', result, error);
      }

      const duration = Date.now() - startTime;
      result.durationMs = duration;

      console.log(
        `[Graph] ✅ Rebuilt ${relationships.length} relationships from ${docs.length} documents (${duration}ms)`,
      );

      return result;
    } catch (error) {
      if (error instanceof GraphDiscoveryError) {
        throw error;
      }

      const duration = Date.now() - startTime;
      const result: GraphDiscoveryResult = {
        mode: 'rebuild',
        processed: 0,
        attemptedPairs: 0,
        relationships: 0,
        skippedInvalidDocuments: 0,
        skippedInsufficientConcepts: 0,
        durationMs: duration,
      };

      logNonFatal('graph.discover_relationships', error);
      throw new GraphDiscoveryError('Relationship discovery failed', result, error);
    }
  }

  /**
   * Get related concepts for a given concept
   */
  async getRelatedConcepts(
    concept: string,
    options: {
      limit?: number;
      minStrength?: number;
      types?: RelationshipType[];
    } = {}
  ): Promise<Array<{ concept: string; relationship: string; strength: number }>> {
    const { limit = 20, minStrength = 1, types } = options;

    try {
      const baseCondition = or(
        and(
          eq(conceptRelationships.relationshipType, CO_OCCURS_RELATIONSHIP),
          or(
            eq(conceptRelationships.fromConcept, concept),
            eq(conceptRelationships.toConcept, concept),
          ),
        ),
        and(
          ne(conceptRelationships.relationshipType, CO_OCCURS_RELATIONSHIP),
          eq(conceptRelationships.fromConcept, concept),
        ),
      );

      const conditions = [
        baseCondition,
        sql`${conceptRelationships.strength} >= ${minStrength}`,
      ];

      if (types && types.length > 0) {
        conditions.push(inArray(conceptRelationships.relationshipType, types));
      }

      const counterpartConcept = sql<string>`
        CASE
          WHEN ${conceptRelationships.relationshipType} = ${CO_OCCURS_RELATIONSHIP}
           AND ${conceptRelationships.fromConcept} = ${concept}
            THEN ${conceptRelationships.toConcept}
          WHEN ${conceptRelationships.relationshipType} = ${CO_OCCURS_RELATIONSHIP}
           AND ${conceptRelationships.toConcept} = ${concept}
            THEN ${conceptRelationships.fromConcept}
          ELSE ${conceptRelationships.toConcept}
        END
      `;

      const results = db
        .select({
          concept: counterpartConcept,
          relationship: conceptRelationships.relationshipType,
          strength: conceptRelationships.strength,
        })
        .from(conceptRelationships)
        .where(and(...conditions.filter(Boolean)))
        .orderBy(desc(conceptRelationships.strength))
        .limit(limit)
        .all();

      return results.map(r => ({
        concept: r.concept || '',
        relationship: r.relationship || 'co-occurs',
        strength: r.strength || 1,
      }));
    } catch (error) {
      logNonFatal('graph.get_related', error, { concept });
      return [];
    }
  }

  /**
   * Find shortest path between two concepts
   * Uses BFS to find connection path
   */
  async findPath(
    fromConcept: string,
    toConcept: string,
    maxDepth: number = 3
  ): Promise<string[] | null> {
    try {
      // Get all relationships for BFS
      const allRels = db
        .select({
          from: conceptRelationships.fromConcept,
          to: conceptRelationships.toConcept,
        })
        .from(conceptRelationships)
        .all();

      // Build adjacency map
      const adjacency = new Map<string, string[]>();
      for (const rel of allRels) {
        if (!rel.from || !rel.to) continue;
        if (!adjacency.has(rel.from)) adjacency.set(rel.from, []);
        adjacency.get(rel.from)!.push(rel.to);
        // Bidirectional
        if (!adjacency.has(rel.to)) adjacency.set(rel.to, []);
        adjacency.get(rel.to)!.push(rel.from);
      }

      // BFS
      const queue: Array<{ concept: string; path: string[] }> = [
        { concept: fromConcept, path: [fromConcept] },
      ];
      const visited = new Set<string>([fromConcept]);

      while (queue.length > 0) {
        const current = queue.shift()!;

        if (current.concept === toConcept) {
          return current.path;
        }

        if (current.path.length >= maxDepth) continue;

        const neighbors = adjacency.get(current.concept) || [];
        for (const neighbor of neighbors) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push({
              concept: neighbor,
              path: [...current.path, neighbor],
            });
          }
        }
      }

      return null; // No path found
    } catch (error) {
      logNonFatal('graph.find_path', error, { fromConcept, toConcept });
      return null;
    }
  }

  /**
   * Get top concepts by connection count
   */
  async getTopConcepts(limit: number = 20): Promise<Array<{ concept: string; connections: number }>> {
    try {
      const statement = sqlite.prepare(`
        SELECT concept, COUNT(*) as connections
        FROM (
          SELECT from_concept AS concept FROM concept_relationships
          UNION ALL
          SELECT to_concept AS concept FROM concept_relationships
        )
        GROUP BY concept
        ORDER BY connections DESC, concept ASC
        LIMIT ?
      `);

      const results = statement.all(limit) as Array<{
        concept: string | null;
        connections: number | null;
      }>;

      return results.map(r => ({
        concept: r.concept || '',
        connections: r.connections || 0,
      }));
    } catch (error) {
      logNonFatal('graph.top_concepts', error);
      return [];
    }
  }

  /**
   * Get graph statistics
   */
  async getStats(): Promise<{
    totalRelationships: number;
    totalConcepts: number;
    byType: Record<string, number>;
    avgStrength: number;
  }> {
    try {
      const totalRels = db
        .select({ count: sql<number>`count(*)` })
        .from(conceptRelationships)
        .get();

      const uniqueConcepts = sqlite
        .prepare(`
          SELECT COUNT(*) as count
          FROM (
            SELECT from_concept AS concept FROM concept_relationships
            UNION
            SELECT to_concept AS concept FROM concept_relationships
          )
        `)
        .get() as { count: number | null };

      const byType = db
        .select({
          type: conceptRelationships.relationshipType,
          count: sql<number>`count(*)`,
        })
        .from(conceptRelationships)
        .groupBy(conceptRelationships.relationshipType)
        .all();

      const avgStrength = db
        .select({
          avg: sql<number>`avg(${conceptRelationships.strength})`,
        })
        .from(conceptRelationships)
        .get();

      return {
        totalRelationships: totalRels?.count || 0,
        totalConcepts: uniqueConcepts?.count || 0,
        byType: byType.reduce((acc, r) => ({ ...acc, [r.type || 'unknown']: r.count || 0 }), {}),
        avgStrength: avgStrength?.avg || 0,
      };
    } catch (error) {
      logNonFatal('graph.stats', error);
      return {
        totalRelationships: 0,
        totalConcepts: 0,
        byType: {},
        avgStrength: 0,
      };
    }
  }
}

// Singleton instance
let graphService: KnowledgeGraphService | null = null;

export function getKnowledgeGraphService(): KnowledgeGraphService {
  if (!graphService) {
    graphService = new KnowledgeGraphService();
  }
  return graphService;
}
