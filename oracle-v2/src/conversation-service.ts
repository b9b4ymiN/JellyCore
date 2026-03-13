/**
 * Conversation History Service (P1)
 * 
 * Manages full conversation history storage and retrieval.
 * Unlike episodic memory which stores summaries, this stores raw messages.
 * 
 * Features:
 * - Store raw user/assistant messages
 * - Full-text search within conversations
 * - Auto-generate conversation titles
 * - TTL-based archival (90 days)
 * - Export conversations for backup
 */

import { eq, desc, and, sql } from 'drizzle-orm';
import { db, sqlite } from './db/index.js';
import { conversations, conversationMessages } from './db/schema.js';
import { logNonFatal } from './non-fatal.js';

export interface Message {
  id?: string;
  conversationId: string;
  userId: string;
  groupId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata?: Record<string, any>;
  createdAt?: number;
  tokens?: number;
  parentMessageId?: string;
}

export interface Conversation {
  id?: string;
  userId: string;
  groupId: string;
  title?: string;
  summary?: string;
  startedAt?: number;
  lastMessageAt?: number;
  messageCount?: number;
  isArchived?: number;
  tags?: string[];
  metadata?: Record<string, any>;
}

export class ConversationService {
  /**
   * Create a new conversation
   */
  async createConversation(conv: Conversation): Promise<string> {
    const now = Date.now();
    const id = conv.id || `conv_${conv.groupId}_${now}`;

    try {
      await db.insert(conversations).values({
        id,
        userId: conv.userId,
        groupId: conv.groupId,
        title: conv.title || null,
        summary: conv.summary || null,
        startedAt: conv.startedAt || now,
        lastMessageAt: conv.lastMessageAt || now,
        messageCount: conv.messageCount || 0,
        isArchived: conv.isArchived || 0,
        tags: conv.tags ? JSON.stringify(conv.tags) : null,
        metadata: conv.metadata ? JSON.stringify(conv.metadata) : null,
      });

      console.log(`[ConversationService] ✅ Created conversation: ${id}`);
      return id;
    } catch (error) {
      logNonFatal('conversation.create', error, { id });
      throw error;
    }
  }

  /**
   * Add a message to conversation
   */
  async addMessage(msg: Message): Promise<string> {
    const now = Date.now();
    const id = msg.id || `msg_${now}_${Math.random().toString(36).substr(2, 9)}`;

    try {
      // Insert message
      await db.insert(conversationMessages).values({
        id,
        conversationId: msg.conversationId,
        userId: msg.userId,
        groupId: msg.groupId,
        role: msg.role,
        content: msg.content,
        metadata: msg.metadata ? JSON.stringify(msg.metadata) : null,
        createdAt: msg.createdAt || now,
        indexed: 0,  // Will be indexed by background job
        tokens: msg.tokens || this.estimateTokens(msg.content),
        parentMessageId: msg.parentMessageId || null,
      });

      // Update conversation metadata
      await db.update(conversations)
        .set({
          lastMessageAt: now,
          messageCount: sql`${conversations.messageCount} + 1`,
        })
        .where(eq(conversations.id, msg.conversationId));

      // Auto-generate title if this is the first user message
      await this.autoGenerateTitle(msg.conversationId);

      console.log(`[ConversationService] ✅ Added message: ${id}`);
      return id;
    } catch (error) {
      logNonFatal('conversation.add_message', error, { messageId: id });
      throw error;
    }
  }

  /**
   * Get conversation by ID
   */
  async getConversation(id: string): Promise<Conversation | null> {
    try {
      const result = await db
        .select()
        .from(conversations)
        .where(eq(conversations.id, id))
        .limit(1);

      if (result.length === 0) return null;

      const conv = result[0];
      return {
        id: conv.id,
        userId: conv.userId,
        groupId: conv.groupId,
        title: conv.title || undefined,
        summary: conv.summary || undefined,
        startedAt: conv.startedAt,
        lastMessageAt: conv.lastMessageAt,
        messageCount: conv.messageCount || 0,
        isArchived: conv.isArchived || 0,
        tags: conv.tags ? JSON.parse(conv.tags) : undefined,
        metadata: conv.metadata ? JSON.parse(conv.metadata) : undefined,
      };
    } catch (error) {
      logNonFatal('conversation.get', error, { id });
      return null;
    }
  }

  /**
   * Get messages in a conversation
   */
  async getMessages(conversationId: string, limit: number = 100, offset: number = 0): Promise<Message[]> {
    try {
      const results = await db
        .select()
        .from(conversationMessages)
        .where(eq(conversationMessages.conversationId, conversationId))
        .orderBy(desc(conversationMessages.createdAt))
        .limit(limit)
        .offset(offset);

      return results.map(msg => ({
        id: msg.id,
        conversationId: msg.conversationId,
        userId: msg.userId,
        groupId: msg.groupId,
        role: msg.role as 'user' | 'assistant' | 'system',
        content: msg.content,
        metadata: msg.metadata ? JSON.parse(msg.metadata) : undefined,
        createdAt: msg.createdAt,
        tokens: msg.tokens || undefined,
        parentMessageId: msg.parentMessageId || undefined,
      }));
    } catch (error) {
      logNonFatal('conversation.get_messages', error, { conversationId });
      return [];
    }
  }

  /**
   * List recent conversations for a user
   */
  async listConversations(
    userId: string,
    options: {
      limit?: number;
      offset?: number;
      groupId?: string;
      includeArchived?: boolean;
    } = {}
  ): Promise<Conversation[]> {
    const { limit = 20, offset = 0, groupId, includeArchived = false } = options;

    try {
      let query = db.select().from(conversations).where(eq(conversations.userId, userId));

      if (groupId) {
        query = query.where(and(
          eq(conversations.userId, userId),
          eq(conversations.groupId, groupId)
        ));
      }

      if (!includeArchived) {
        query = query.where(and(
          eq(conversations.userId, userId),
          eq(conversations.isArchived, 0)
        ));
      }

      const results = await query
        .orderBy(desc(conversations.lastMessageAt))
        .limit(limit)
        .offset(offset);

      return results.map(conv => ({
        id: conv.id,
        userId: conv.userId,
        groupId: conv.groupId,
        title: conv.title || undefined,
        summary: conv.summary || undefined,
        startedAt: conv.startedAt,
        lastMessageAt: conv.lastMessageAt,
        messageCount: conv.messageCount || 0,
        isArchived: conv.isArchived || 0,
        tags: conv.tags ? JSON.parse(conv.tags) : undefined,
        metadata: conv.metadata ? JSON.parse(conv.metadata) : undefined,
      }));
    } catch (error) {
      logNonFatal('conversation.list', error, { userId });
      return [];
    }
  }

  /**
   * Search within a conversation
   */
  async searchInConversation(conversationId: string, query: string, limit: number = 10): Promise<Message[]> {
    try {
      // Use FTS5 if messages are indexed, otherwise use LIKE
      const results = await db
        .select()
        .from(conversationMessages)
        .where(
          and(
            eq(conversationMessages.conversationId, conversationId),
            sql`${conversationMessages.content} LIKE ${'%' + query + '%'}`
          )
        )
        .orderBy(desc(conversationMessages.createdAt))
        .limit(limit);

      return results.map(msg => ({
        id: msg.id,
        conversationId: msg.conversationId,
        userId: msg.userId,
        groupId: msg.groupId,
        role: msg.role as 'user' | 'assistant' | 'system',
        content: msg.content,
        metadata: msg.metadata ? JSON.parse(msg.metadata) : undefined,
        createdAt: msg.createdAt,
        tokens: msg.tokens || undefined,
        parentMessageId: msg.parentMessageId || undefined,
      }));
    } catch (error) {
      logNonFatal('conversation.search', error, { conversationId, query });
      return [];
    }
  }

  /**
   * Archive a conversation
   */
  async archiveConversation(id: string): Promise<void> {
    try {
      await db.update(conversations)
        .set({ isArchived: 1 })
        .where(eq(conversations.id, id));

      console.log(`[ConversationService] 📦 Archived conversation: ${id}`);
    } catch (error) {
      logNonFatal('conversation.archive', error, { id });
    }
  }

  /**
   * Auto-generate conversation title from first message
   */
  private async autoGenerateTitle(conversationId: string): Promise<void> {
    try {
      // Check if title already exists
      const conv = await this.getConversation(conversationId);
      if (!conv || conv.title) return;

      // Get first user message
      const messages = await db
        .select()
        .from(conversationMessages)
        .where(
          and(
            eq(conversationMessages.conversationId, conversationId),
            eq(conversationMessages.role, 'user')
          )
        )
        .orderBy(conversationMessages.createdAt)
        .limit(1);

      if (messages.length === 0) return;

      // Generate title from first 50 chars
      let title = messages[0].content.substring(0, 50).trim();
      if (messages[0].content.length > 50) {
        title += '...';
      }

      await db.update(conversations)
        .set({ title })
        .where(eq(conversations.id, conversationId));

      console.log(`[ConversationService] 📝 Generated title: ${title}`);
    } catch (error) {
      logNonFatal('conversation.auto_title', error, { conversationId });
    }
  }

  /**
   * Estimate token count (rough approximation)
   */
  private estimateTokens(text: string): number {
    // Rough estimate: ~4 chars per token for English, ~2 for Thai
    const hasThai = /[\u0E00-\u0E7F]/.test(text);
    return Math.ceil(text.length / (hasThai ? 2 : 4));
  }

  /**
   * Get conversation statistics
   */
  async getStats(userId?: string): Promise<{
    totalConversations: number;
    totalMessages: number;
    activeConversations: number;
    archivedConversations: number;
  }> {
    try {
      let convQuery = db.select({
        count: sql<number>`count(*)`,
        active: sql<number>`sum(case when ${conversations.isArchived} = 0 then 1 else 0 end)`,
        archived: sql<number>`sum(case when ${conversations.isArchived} = 1 then 1 else 0 end)`,
      }).from(conversations);

      if (userId) {
        convQuery = convQuery.where(eq(conversations.userId, userId));
      }

      const convStats = await convQuery;

      let msgQuery = db.select({
        count: sql<number>`count(*)`,
      }).from(conversationMessages);

      if (userId) {
        msgQuery = msgQuery.where(eq(conversationMessages.userId, userId));
      }

      const msgStats = await msgQuery;

      return {
        totalConversations: convStats[0]?.count || 0,
        totalMessages: msgStats[0]?.count || 0,
        activeConversations: convStats[0]?.active || 0,
        archivedConversations: convStats[0]?.archived || 0,
      };
    } catch (error) {
      logNonFatal('conversation.stats', error, { userId });
      return {
        totalConversations: 0,
        totalMessages: 0,
        activeConversations: 0,
        archivedConversations: 0,
      };
    }
  }
}

// Singleton instance
let conversationService: ConversationService | null = null;

export function getConversationService(): ConversationService {
  if (!conversationService) {
    conversationService = new ConversationService();
  }
  return conversationService;
}
