/**
 * Conversation API Routes (P1)
 * 
 * REST endpoints for conversation history management
 */

import { Hono } from 'hono';
import { getConversationService } from '../../conversation-service.js';

const app = new Hono();
const conversationService = getConversationService();

/**
 * GET /api/conversations/stats
 * Get conversation statistics (MUST be before /:id route)
 */
app.get('/stats', async (c) => {
  try {
    const userId = c.req.query('userId');
    const stats = await conversationService.getStats(userId);

    return c.json({ stats });
  } catch (error) {
    console.error('[API] Get stats error:', error);
    return c.json({ error: 'Failed to get stats' }, 500);
  }
});

/**
 * POST /api/conversations
 * Create a new conversation
 */
app.post('/', async (c) => {
  try {
    const body = await c.req.json();
    const { userId, groupId, title, metadata, tags } = body;

    if (!userId || !groupId) {
      return c.json({ error: 'Missing userId or groupId' }, 400);
    }

    const id = await conversationService.createConversation({
      userId,
      groupId,
      title,
      metadata,
      tags,
    });

    return c.json({ id, message: 'Conversation created' });
  } catch (error) {
    console.error('[API] Create conversation error:', error);
    return c.json({ error: 'Failed to create conversation' }, 500);
  }
});

/**
 * GET /api/conversations
 * List conversations for a user
 */
app.get('/', async (c) => {
  try {
    const userId = c.req.query('userId');
    const groupId = c.req.query('groupId');
    const limit = parseInt(c.req.query('limit') || '20');
    const offset = parseInt(c.req.query('offset') || '0');
    const includeArchived = c.req.query('includeArchived') === 'true';

    if (!userId) {
      return c.json({ error: 'Missing userId parameter' }, 400);
    }

    const conversations = await conversationService.listConversations(userId, {
      limit,
      offset,
      groupId,
      includeArchived,
    });

    return c.json({
      conversations,
      pagination: {
        limit,
        offset,
        hasMore: conversations.length === limit,
      },
    });
  } catch (error) {
    console.error('[API] List conversations error:', error);
    return c.json({ error: 'Failed to list conversations' }, 500);
  }
});

/**
 * GET /api/conversations/:id
 * Get a specific conversation
 */
app.get('/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const conversation = await conversationService.getConversation(id);

    if (!conversation) {
      return c.json({ error: 'Conversation not found' }, 404);
    }

    return c.json({ conversation });
  } catch (error) {
    console.error('[API] Get conversation error:', error);
    return c.json({ error: 'Failed to get conversation' }, 500);
  }
});

/**
 * POST /api/conversations/:id/messages
 * Add a message to conversation
 */
app.post('/:id/messages', async (c) => {
  try {
    const conversationId = c.req.param('id');
    const body = await c.req.json();
    const { userId, groupId, role, content, metadata, parentMessageId } = body;

    if (!userId || !groupId || !role || !content) {
      return c.json({ error: 'Missing required fields' }, 400);
    }

    if (!['user', 'assistant', 'system'].includes(role)) {
      return c.json({ error: 'Invalid role. Must be user, assistant, or system' }, 400);
    }

    const messageId = await conversationService.addMessage({
      conversationId,
      userId,
      groupId,
      role,
      content,
      metadata,
      parentMessageId,
    });

    return c.json({ id: messageId, message: 'Message added' });
  } catch (error) {
    console.error('[API] Add message error:', error);
    return c.json({ error: 'Failed to add message' }, 500);
  }
});

/**
 * GET /api/conversations/:id/messages
 * Get messages in a conversation
 */
app.get('/:id/messages', async (c) => {
  try {
    const conversationId = c.req.param('id');
    const limit = parseInt(c.req.query('limit') || '100');
    const offset = parseInt(c.req.query('offset') || '0');

    const messages = await conversationService.getMessages(conversationId, limit, offset);

    return c.json({
      messages,
      pagination: {
        limit,
        offset,
        hasMore: messages.length === limit,
      },
    });
  } catch (error) {
    console.error('[API] Get messages error:', error);
    return c.json({ error: 'Failed to get messages' }, 500);
  }
});

/**
 * GET /api/conversations/:id/search
 * Search within a conversation
 */
app.get('/:id/search', async (c) => {
  try {
    const conversationId = c.req.param('id');
    const query = c.req.query('q');
    const limit = parseInt(c.req.query('limit') || '10');

    if (!query) {
      return c.json({ error: 'Missing query parameter' }, 400);
    }

    const messages = await conversationService.searchInConversation(conversationId, query, limit);

    return c.json({
      messages,
      query,
      resultsCount: messages.length,
    });
  } catch (error) {
    console.error('[API] Search conversation error:', error);
    return c.json({ error: 'Failed to search conversation' }, 500);
  }
});

/**
 * POST /api/conversations/:id/archive
 * Archive a conversation
 */
app.post('/:id/archive', async (c) => {
  try {
    const id = c.req.param('id');
    await conversationService.archiveConversation(id);

    return c.json({ message: 'Conversation archived' });
  } catch (error) {
    console.error('[API] Archive conversation error:', error);
    return c.json({ error: 'Failed to archive conversation' }, 500);
  }
});

export function registerConversationRoutes(parentApp: Hono) {
  parentApp.route('/api/conversations', app);
  console.log('[API] Conversation routes registered');
}
