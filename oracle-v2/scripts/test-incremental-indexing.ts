#!/usr/bin/env bun
/**
 * Test Script for P0: Incremental Indexing
 * 
 * Tests that newly written files are searchable within 5 seconds.
 * 
 * Usage: bun scripts/test-incremental-indexing.ts
 */

import fs from 'fs';
import path from 'path';

const ORACLE_API = process.env.ORACLE_API_URL || 'http://localhost:47778';
const TEST_DIR = path.join(process.cwd(), 'ψ/memory/learnings');
const TEST_PATTERN = `Test incremental indexing at ${Date.now()}`;
const TEST_FILENAME = `test-incremental-${Date.now()}.md`;
const TEST_FILEPATH = path.join(TEST_DIR, TEST_FILENAME);

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function searchOracle(query: string): Promise<any> {
  const url = `${ORACLE_API}/api/search?q=${encodeURIComponent(query)}&limit=10`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Search failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function runTest(): Promise<void> {
  console.log(`${colors.blue}🧪 Testing P0: Incremental Indexing${colors.reset}\n`);

  // Step 1: Write test file
  console.log(`${colors.yellow}Step 1: Writing test file...${colors.reset}`);
  const content = `---
title: Test Incremental Indexing
tags: [test, incremental, indexing]
created: ${new Date().toISOString()}
---

# Test Incremental Indexing

${TEST_PATTERN}

This is a test file to verify that incremental indexing works correctly.
Files should be searchable within 2-5 seconds after being written.
`;

  fs.writeFileSync(TEST_FILEPATH, content, 'utf-8');
  console.log(`${colors.green}✅ Written: ${TEST_FILENAME}${colors.reset}\n`);

  // Step 2: Wait for debounce + indexing
  console.log(`${colors.yellow}Step 2: Waiting 5 seconds for indexing...${colors.reset}`);
  await sleep(5000);

  // Step 3: Search for the pattern
  console.log(`${colors.yellow}Step 3: Searching for pattern...${colors.reset}`);
  const searchQuery = 'incremental indexing test';
  
  try {
    const results = await searchOracle(searchQuery);
    
    // Check if our test file is in results
    const found = results.results?.some((r: any) => {
      // Debug: print what we got
      console.log(`${colors.blue}[DEBUG] Result:${colors.reset}`);
      console.log(`  ID: ${r.document?.id || r.id || 'no id'}`);
      console.log(`  Source: ${r.document?.source_file || r.source_file || 'no source'}`);
      console.log(`  Content preview: ${(r.document?.content || r.content || '').substring(0, 100)}`);
      
      return r.document?.content?.includes(TEST_PATTERN) ||
             r.document?.source_file?.includes(TEST_FILENAME) ||
             r.document?.id?.includes(TEST_FILENAME.replace('.md', '')) ||
             (r.id && r.id.includes(TEST_FILENAME.replace('.md', '')));
    });

    if (found) {
      console.log(`${colors.green}✅ SUCCESS: Test file found in search results!${colors.reset}`);
      console.log(`${colors.green}   Indexing latency: < 5 seconds${colors.reset}\n`);
      
      // Show matching result
      const match = results.results.find((r: any) => 
        r.document?.content?.includes(TEST_PATTERN)
      );
      if (match) {
        console.log(`${colors.blue}📄 Matched Document:${colors.reset}`);
        console.log(`   ID: ${match.document.id}`);
        console.log(`   Type: ${match.document.type}`);
        console.log(`   Source: ${match.document.source_file}`);
        console.log(`   Score: ${match.score}`);
      }
    } else {
      console.log(`${colors.red}❌ FAILED: Test file NOT found in search results${colors.reset}`);
      console.log(`${colors.red}   Incremental indexing may not be working${colors.reset}\n`);
      
      // Show what was found
      console.log(`${colors.yellow}Search returned ${results.results?.length || 0} results:${colors.reset}`);
      results.results?.slice(0, 3).forEach((r: any, i: number) => {
        console.log(`   ${i + 1}. ${r.document?.id || 'unknown'}`);
      });
      
      process.exit(1);
    }
  } catch (error) {
    console.log(`${colors.red}❌ FAILED: Search error${colors.reset}`);
    console.error(error);
    process.exit(1);
  }

  // Step 4: Cleanup
  console.log(`${colors.yellow}Step 4: Cleaning up...${colors.reset}`);
  try {
    fs.unlinkSync(TEST_FILEPATH);
    console.log(`${colors.green}✅ Deleted test file${colors.reset}\n`);
  } catch (error) {
    console.warn(`${colors.yellow}⚠️  Could not delete test file: ${error}${colors.reset}\n`);
  }

  // Final summary
  console.log(`${colors.green}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
  console.log(`${colors.green}✅ P0 Test PASSED${colors.reset}`);
  console.log(`${colors.green}   Real-time indexing is working correctly!${colors.reset}`);
  console.log(`${colors.green}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}\n`);
}

// Pre-flight checks
async function preflightChecks(): Promise<void> {
  console.log(`${colors.blue}🔍 Pre-flight checks...${colors.reset}\n`);

  // Check if test directory exists
  if (!fs.existsSync(TEST_DIR)) {
    console.log(`${colors.red}❌ Test directory not found: ${TEST_DIR}${colors.reset}`);
    process.exit(1);
  }
  console.log(`${colors.green}✅ Test directory exists${colors.reset}`);

  // Check if Oracle API is reachable
  try {
    const response = await fetch(`${ORACLE_API}/api/health`);
    if (!response.ok) {
      throw new Error(`Health check failed: ${response.status}`);
    }
    console.log(`${colors.green}✅ Oracle API is reachable${colors.reset}`);
  } catch (error) {
    console.log(`${colors.red}❌ Oracle API not reachable: ${ORACLE_API}${colors.reset}`);
    console.log(`${colors.yellow}   Make sure server is running: bun run server${colors.reset}`);
    process.exit(1);
  }

  console.log('');
}

// Main
(async () => {
  try {
    await preflightChecks();
    await runTest();
  } catch (error) {
    console.error(`${colors.red}❌ Test failed with error:${colors.reset}`, error);
    process.exit(1);
  }
})();
