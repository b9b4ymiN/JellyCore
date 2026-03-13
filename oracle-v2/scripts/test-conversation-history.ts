#!/usr/bin/env bun
/**
 * Test Script for P1: Conversation History
 * 
 * Tests full conversation storage and retrieval.
 * 
 * Usage: bun scripts/test-conversation-history.ts
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

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testConversationHistory(): Promise<void> {
  console.log(`${colors.blue}🧪 Testing P1: Conversation History${colors.reset}\n`);

  const testUserId = 'test-user-' + Date.now();
  const testGroupId = 'test-group-' + Date.now();
  let conversationId: string;

  try {
    // Test 1: Create conversation
    console.log(`${colors.yellow}Test 1: Creating conversation...${colors.reset}`);
    const createResp = await fetch(`${ORACLE_API}/api/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: testUserId,
        groupId: testGroupId,
        tags: ['test', 'automated'],
      }),
    });

    if (!createResp.ok) {
      throw new Error(`Create failed: ${createResp.status}`);
    }

    const createData = await createResp.json();
    conversationId = createData.id;
    console.log(`${colors.green}✅ Created conversation: ${conversationId}${colors.reset}\n`);

    // Test 2: Add user message
    console.log(`${colors.yellow}Test 2: Adding user message...${colors.reset}`);
    const userMsgResp = await fetch(`${ORACLE_API}/api/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: testUserId,
        groupId: testGroupId,
        role: 'user',
        content: 'Hello! Can you help me test the conversation history feature?',
      }),
    });

    if (!userMsgResp.ok) {
      throw new Error(`Add user message failed: ${userMsgResp.status}`);
    }

    const userMsgData = await userMsgResp.json();
    console.log(`${colors.green}✅ Added user message: ${userMsgData.id}${colors.reset}\n`);

    // Test 3: Add assistant message
    console.log(`${colors.yellow}Test 3: Adding assistant message...${colors.reset}`);
    const assistantMsgResp = await fetch(`${ORACLE_API}/api/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: testUserId,
        groupId: testGroupId,
        role: 'assistant',
        content: 'Of course! I\'d be happy to help test the conversation history feature. This message is being stored in the database with full metadata.',
        metadata: { model: 'test', tokens: 42 },
      }),
    });

    if (!assistantMsgResp.ok) {
      throw new Error(`Add assistant message failed: ${assistantMsgResp.status}`);
    }

    const assistantMsgData = await assistantMsgResp.json();
    console.log(`${colors.green}✅ Added assistant message: ${assistantMsgData.id}${colors.reset}\n`);

    // Wait for auto-title generation
    await sleep(1000);

    // Test 4: Retrieve conversation
    console.log(`${colors.yellow}Test 4: Retrieving conversation...${colors.reset}`);
    const getConvResp = await fetch(`${ORACLE_API}/api/conversations/${conversationId}`);

    if (!getConvResp.ok) {
      throw new Error(`Get conversation failed: ${getConvResp.status}`);
    }

    const convData = await getConvResp.json();
    console.log(`${colors.green}✅ Retrieved conversation${colors.reset}`);
    console.log(`   Title: ${convData.conversation.title || '(none)'}`);
    console.log(`   Message Count: ${convData.conversation.messageCount}`);
    console.log(`   Started: ${new Date(convData.conversation.startedAt).toLocaleString()}\n`);

    // Test 5: Get messages
    console.log(`${colors.yellow}Test 5: Retrieving messages...${colors.reset}`);
    const getMsgsResp = await fetch(`${ORACLE_API}/api/conversations/${conversationId}/messages?limit=10`);

    if (!getMsgsResp.ok) {
      throw new Error(`Get messages failed: ${getMsgsResp.status}`);
    }

    const msgsData = await getMsgsResp.json();
    console.log(`${colors.green}✅ Retrieved ${msgsData.messages.length} messages${colors.reset}`);
    
    msgsData.messages.forEach((msg: any, i: number) => {
      const preview = msg.content.substring(0, 50) + (msg.content.length > 50 ? '...' : '');
      console.log(`   ${i + 1}. [${msg.role}] ${preview}`);
    });
    console.log('');

    // Test 6: Search in conversation
    console.log(`${colors.yellow}Test 6: Searching within conversation...${colors.reset}`);
    const searchResp = await fetch(
      `${ORACLE_API}/api/conversations/${conversationId}/search?q=test&limit=5`
    );

    if (!searchResp.ok) {
      throw new Error(`Search failed: ${searchResp.status}`);
    }

    const searchData = await searchResp.json();
    console.log(`${colors.green}✅ Found ${searchData.resultsCount} matching messages${colors.reset}\n`);

    // Test 7: List conversations
    console.log(`${colors.yellow}Test 7: Listing conversations for user...${colors.reset}`);
    const listResp = await fetch(`${ORACLE_API}/api/conversations?userId=${testUserId}&limit=10`);

    if (!listResp.ok) {
      throw new Error(`List failed: ${listResp.status}`);
    }

    const listData = await listResp.json();
    console.log(`${colors.green}✅ Found ${listData.conversations.length} conversations${colors.reset}\n`);

    // Test 8: Get stats
    console.log(`${colors.yellow}Test 8: Getting statistics...${colors.reset}`);
    const statsResp = await fetch(`${ORACLE_API}/api/conversations/stats?userId=${testUserId}`);

    if (!statsResp.ok) {
      throw new Error(`Stats failed: ${statsResp.status}`);
    }

    const statsData = await statsResp.json();
    console.log(`${colors.green}✅ Statistics retrieved${colors.reset}`);
    console.log(`   Total Conversations: ${statsData.stats.totalConversations}`);
    console.log(`   Total Messages: ${statsData.stats.totalMessages}`);
    console.log(`   Active: ${statsData.stats.activeConversations}`);
    console.log(`   Archived: ${statsData.stats.archivedConversations}\n`);

    // Success summary
    console.log(`${colors.green}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
    console.log(`${colors.green}✅ P1 Test PASSED${colors.reset}`);
    console.log(`${colors.green}   All conversation history features working!${colors.reset}`);
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
    await testConversationHistory();
  } catch (error) {
    console.error(`${colors.red}❌ Test suite failed:${colors.reset}`, error);
    process.exit(1);
  }
})();
