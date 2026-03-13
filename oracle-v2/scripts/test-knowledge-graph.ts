#!/usr/bin/env bun
/**
 * Test Script for P4: Knowledge Graph
 * 
 * Tests relationship discovery and graph queries.
 * 
 * Usage: bun scripts/test-knowledge-graph.ts
 */

const ORACLE_API = process.env.ORACLE_API_URL || 'http://localhost:47778';

// Colors
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

async function testKnowledgeGraph(): Promise<void> {
  console.log(`${colors.blue}🧪 Testing P4: Knowledge Graph${colors.reset}\n`);

  try {
    // Test 1: Discover relationships
    console.log(`${colors.yellow}Test 1: Discovering relationships...${colors.reset}`);
    const discoverResp = await fetch(`${ORACLE_API}/api/graph/discover`, {
      method: 'POST',
    });

    if (!discoverResp.ok) {
      throw new Error(`Discovery failed: ${discoverResp.status}`);
    }

    const discoverData = await discoverResp.json();
    console.log(`${colors.green}✅ Discovered relationships${colors.reset}`);
    console.log(`   Processed: ${discoverData.processed} documents`);
    console.log(`   Relationships: ${discoverData.relationships}\n`);

    // Test 2: Get graph stats
    console.log(`${colors.yellow}Test 2: Getting graph statistics...${colors.reset}`);
    const statsResp = await fetch(`${ORACLE_API}/api/graph/stats`);

    if (!statsResp.ok) {
      throw new Error(`Stats failed: ${statsResp.status}`);
    }

    const statsData = await statsResp.json();
    console.log(`${colors.green}✅ Graph statistics${colors.reset}`);
    console.log(`   Total Relationships: ${statsData.stats.totalRelationships}`);
    console.log(`   Total Concepts: ${statsData.stats.totalConcepts}`);
    console.log(`   Avg Strength: ${statsData.stats.avgStrength.toFixed(2)}`);
    console.log(`   By Type:`, statsData.stats.byType, '\n');

    // Test 3: Get top concepts
    console.log(`${colors.yellow}Test 3: Getting top concepts...${colors.reset}`);
    const topResp = await fetch(`${ORACLE_API}/api/graph/top-concepts?limit=10`);

    if (!topResp.ok) {
      throw new Error(`Top concepts failed: ${topResp.status}`);
    }

    const topData = await topResp.json();
    console.log(`${colors.green}✅ Top 10 connected concepts:${colors.reset}`);
    topData.concepts.forEach((c: any, i: number) => {
      console.log(`   ${i + 1}. "${c.concept}" - ${c.connections} connections`);
    });
    console.log('');

    // Test 4: Get related concepts (if we have any)
    if (topData.concepts.length > 0) {
      const testConcept = topData.concepts[0].concept;
      console.log(`${colors.yellow}Test 4: Getting related concepts for "${testConcept}"...${colors.reset}`);
      
      const relatedResp = await fetch(
        `${ORACLE_API}/api/graph/concepts/${encodeURIComponent(testConcept)}/related?limit=5`
      );

      if (!relatedResp.ok) {
        throw new Error(`Related concepts failed: ${relatedResp.status}`);
      }

      const relatedData = await relatedResp.json();
      console.log(`${colors.green}✅ Found ${relatedData.count} related concepts:${colors.reset}`);
      relatedData.related.forEach((r: any, i: number) => {
        console.log(`   ${i + 1}. "${r.concept}" (${r.relationship}, strength: ${r.strength})`);
      });
      console.log('');
    }

    // Test 5: Find path between concepts (if we have at least 2)
    if (topData.concepts.length >= 2) {
      const from = topData.concepts[0].concept;
      const to = topData.concepts[1].concept;
      console.log(`${colors.yellow}Test 5: Finding path from "${from}" to "${to}"...${colors.reset}`);
      
      const pathResp = await fetch(
        `${ORACLE_API}/api/graph/path?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
      );

      const pathData = await pathResp.json();
      
      if (pathResp.ok && pathData.path) {
        console.log(`${colors.green}✅ Path found (length: ${pathData.length}):${colors.reset}`);
        console.log(`   ${pathData.path.join(' → ')}\n`);
      } else {
        console.log(`${colors.yellow}⚠️  No path found between these concepts\n${colors.reset}`);
      }
    }

    // Success summary
    console.log(`${colors.green}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
    console.log(`${colors.green}✅ P4 Test PASSED${colors.reset}`);
    console.log(`${colors.green}   Knowledge Graph features working!${colors.reset}`);
    console.log(`${colors.green}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}\n`);

  } catch (error) {
    console.error(`${colors.red}❌ Test failed:${colors.reset}`, error);
    process.exit(1);
  }
}

// Pre-flight checks
async function preflightChecks(): Promise<void> {
  console.log(`${colors.blue}🔍 Pre-flight checks...${colors.reset}\n`);

  try {
    const response = await fetch(`${ORACLE_API}/api/health`);
    if (!response.ok) {
      throw new Error(`Health check failed: ${response.status}`);
    }
    console.log(`${colors.green}✅ Oracle API is reachable${colors.reset}\n`);
  } catch (error) {
    console.log(`${colors.red}❌ Oracle API not reachable: ${ORACLE_API}${colors.reset}`);
    console.log(`${colors.yellow}   Make sure server is running: bun run server${colors.reset}`);
    process.exit(1);
  }
}

// Main
(async () => {
  try {
    await preflightChecks();
    await testKnowledgeGraph();
  } catch (error) {
    console.error(`${colors.red}❌ Test suite failed:${colors.reset}`, error);
    process.exit(1);
  }
})();
