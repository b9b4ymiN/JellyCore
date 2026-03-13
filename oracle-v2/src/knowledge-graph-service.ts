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

import { eq, desc, and, or, sql, inArray } from 'drizzle-orm';
import { db } from './db/index.js';
import { conceptRelationships, oracleDocuments } from './db/schema.js';
import { logNonFatal } from './non-fatal.js';

export type RelationshipType = 'co-occurs' | 'related_to' | 'part_of' | 'prerequisite';

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

export class KnowledgeGraphService {
  /**
   * Record a relationship between two concepts
   */
  async recordRelationship(rel: ConceptRelationship): Promise<void> {
    const now = Date.now();
    const id = rel.id || `rel_${rel.fromConcept}_${rel.toConcept}_${rel.relationshipType}`;

    try {
      // Check if relationship exists
      const existing = await db
        .select()
        .from(conceptRelationships)
        .where(
          and(
            eq(conceptRelationships.fromConcept, rel.fromConcept),
            eq(conceptRelationships.toConcept, rel.toConcept),
            eq(conceptRelationships.relationshipType, rel.relationshipType)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        // Update existing: increment strength
        await db
          .update(conceptRelationships)
          .set({
            strength: sql`${conceptRelationships.strength} + 1`,
            lastSeen: now,
          })
          .where(eq(conceptRelationships.id, existing[0].id));

        console.log(`[Graph] Updated relationship: ${rel.fromConcept} -> ${rel.toConcept}`);
      } else {
        // Insert new
        await db.insert(conceptRelationships).values({
          id,
          fromConcept: rel.fromConcept,
          toConcept: rel.toConcept,
          relationshipType: rel.relationshipType,
          strength: rel.strength || 1,
          lastSeen: now,
          createdAt: now,
          metadata: rel.metadata ? JSON.stringify(rel.metadata) : null,
        });

        console.log(`[Graph] Created relationship: ${rel.fromConcept} -> ${rel.toConcept}`);
      }
    } catch (error) {
      logNonFatal('graph.record_relationship', error, { rel });
    }
  }

  /**
   * Discover relationships from all documents
   * Analyzes concept co-occurrence patterns
   */
  async discoverRelationships(): Promise<{ processed: number; relationships: number }> {
    console.log('[Graph] 🔍 Discovering relationships...');
    const startTime = Date.now();

    try {
      // Get all documents with concepts
      const docs = await db
        .select({
          id: oracleDocuments.id,
          concepts: oracleDocuments.concepts,
        })
        .from(oracleDocuments)
        .all();

      let relationshipCount = 0;

      for (const doc of docs) {
        let concepts: string[] = [];
        try {
          const parsed = JSON.parse(doc.concepts || '[]');
          if (Array.isArray(parsed)) {
            concepts = parsed.filter((c): c is string => typeof c === 'string');
          }
        } catch {
          continue;
        }

        // Record co-occurrence relationships
        for (let i = 0; i < concepts.length; i++) {
          for (let j = i + 1; j < concepts.length; j++) {
            await this.recordRelationship({
              fromConcept: concepts[i],
              toConcept: concepts[j],
              relationshipType: 'co-occurs',
            });
            relationshipCount++;
          }
        }
      }

      const duration = Date.now() - startTime;
      console.log(`[Graph] ✅ Discovered ${relationshipCount} relationships from ${docs.length} documents (${duration}ms)`);

      return { processed: docs.length, relationships: relationshipCount };
    } catch (error) {
      logNonFatal('graph.discover_relationships', error);
      return { processed: 0, relationships: 0 };
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
      const conditions = [
        eq(conceptRelationships.fromConcept, concept),
        sql`${conceptRelationships.strength} >= ${minStrength}`
      ];

      if (types && types.length > 0) {
        conditions.push(inArray(conceptRelationships.relationshipType, types));
      }

      const results = await db
        .select({
          concept: conceptRelationships.toConcept,
          relationship: conceptRelationships.relationshipType,
          strength: conceptRelationships.strength,
        })
        .from(conceptRelationships)
        .where(and(...conditions))
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
      const allRels = await db
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
      const results = await db
        .select({
          concept: conceptRelationships.fromConcept,
          connections: sql<number>`count(*)`,
        })
        .from(conceptRelationships)
        .groupBy(conceptRelationships.fromConcept)
        .orderBy(desc(sql`count(*)`))
        .limit(limit)
        .all();

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
      const totalRels = await db
        .select({ count: sql<number>`count(*)` })
        .from(conceptRelationships)
        .get();

      const uniqueConcepts = await db
        .select({
          count: sql<number>`count(distinct ${conceptRelationships.fromConcept})`,
        })
        .from(conceptRelationships)
        .get();

      const byType = await db
        .select({
          type: conceptRelationships.relationshipType,
          count: sql<number>`count(*)`,
        })
        .from(conceptRelationships)
        .groupBy(conceptRelationships.relationshipType)
        .all();

      const avgStrength = await db
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
