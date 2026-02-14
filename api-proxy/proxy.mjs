/**
 * Anthropic Messages API → OpenAI Chat Completions Proxy
 *
 * Translates requests from Anthropic format (used by claude-agent-sdk)
 * to OpenAI format (used by Z.AI/GLM) and back.
 *
 * Usage:
 *   ANTHROPIC_BASE_URL=http://localhost:4100  (in .env)
 *   node proxy.mjs
 */

import { createServer } from 'node:http';

// ─── Config ─────────────────────────────────────────────────────────
const PROXY_PORT = parseInt(process.env.PROXY_PORT || '4100');
const TARGET_URL = process.env.TARGET_URL || 'https://api.z.ai/api/coding/paas/v4/chat/completions';
const TARGET_MODEL = process.env.TARGET_MODEL || 'GLM-4.7';
const TARGET_API_KEY = process.env.TARGET_API_KEY || process.env.ANTHROPIC_API_KEY || '';

console.log(`[proxy] Target: ${TARGET_URL}`);
console.log(`[proxy] Model:  ${TARGET_MODEL}`);
console.log(`[proxy] Port:   ${PROXY_PORT}`);

// ─── Anthropic → OpenAI message translation ─────────────────────────
function translateMessages(anthropicMessages, systemPrompt) {
  const messages = [];

  // System prompt → OpenAI system message
  if (systemPrompt) {
    const text = typeof systemPrompt === 'string'
      ? systemPrompt
      : Array.isArray(systemPrompt)
        ? systemPrompt.map(b => b.text || '').join('\n')
        : '';
    if (text) messages.push({ role: 'system', content: text });
  }

  for (const msg of anthropicMessages) {
    if (msg.role === 'user') {
      // Handle array content (text + images + tool_result)
      if (Array.isArray(msg.content)) {
        const toolResults = msg.content.filter(b => b.type === 'tool_result');
        const otherContent = msg.content.filter(b => b.type !== 'tool_result');

        // Tool results → separate tool messages
        for (const tr of toolResults) {
          const resultContent = typeof tr.content === 'string'
            ? tr.content
            : Array.isArray(tr.content)
              ? tr.content.map(b => b.text || JSON.stringify(b)).join('\n')
              : JSON.stringify(tr.content);
          messages.push({
            role: 'tool',
            tool_call_id: tr.tool_use_id,
            content: resultContent,
          });
        }

        // Text/image content → user message
        if (otherContent.length > 0) {
          const text = otherContent.map(b => {
            if (b.type === 'text') return b.text;
            if (b.type === 'image') return '[image]';
            return JSON.stringify(b);
          }).join('\n');
          if (text) messages.push({ role: 'user', content: text });
        }
      } else {
        messages.push({ role: 'user', content: msg.content });
      }
    } else if (msg.role === 'assistant') {
      if (Array.isArray(msg.content)) {
        const textParts = [];
        const toolCalls = [];

        for (const block of msg.content) {
          if (block.type === 'text') {
            textParts.push(block.text);
          } else if (block.type === 'tool_use') {
            toolCalls.push({
              id: block.id,
              type: 'function',
              function: {
                name: block.name,
                arguments: typeof block.input === 'string' ? block.input : JSON.stringify(block.input),
              },
            });
          }
        }

        const assistantMsg = {
          role: 'assistant',
          content: textParts.join('\n') || null,
        };
        if (toolCalls.length > 0) assistantMsg.tool_calls = toolCalls;
        messages.push(assistantMsg);
      } else {
        messages.push({ role: 'assistant', content: msg.content });
      }
    }
  }

  return messages;
}

// ─── Anthropic tools → OpenAI tools ──────────────────────────────────
function translateTools(anthropicTools) {
  if (!anthropicTools || anthropicTools.length === 0) return undefined;

  return anthropicTools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description || '',
      parameters: tool.input_schema || { type: 'object', properties: {} },
    },
  }));
}

// ─── OpenAI response → Anthropic response ────────────────────────────
function translateResponse(openaiResp, requestModel) {
  const choice = openaiResp.choices?.[0];
  if (!choice) {
    return {
      id: openaiResp.id || `msg_${Date.now()}`,
      type: 'message',
      role: 'assistant',
      model: requestModel,
      content: [{ type: 'text', text: '' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 0, output_tokens: 0 },
    };
  }

  const msg = choice.message;
  const content = [];

  // Text content
  if (msg.content) {
    // Include reasoning if present
    const text = msg.reasoning_content
      ? `<thinking>${msg.reasoning_content}</thinking>\n\n${msg.content}`
      : msg.content;
    content.push({ type: 'text', text });
  }

  // Tool calls → tool_use blocks
  if (msg.tool_calls) {
    for (const tc of msg.tool_calls) {
      let input;
      try {
        input = JSON.parse(tc.function.arguments);
      } catch {
        input = { raw: tc.function.arguments };
      }
      content.push({
        type: 'tool_use',
        id: tc.id || `toolu_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: tc.function.name,
        input,
      });
    }
  }

  // If no content at all, add empty text
  if (content.length === 0) {
    const text = msg.reasoning_content || '';
    content.push({ type: 'text', text });
  }

  // Map stop reason
  let stop_reason = 'end_turn';
  if (choice.finish_reason === 'tool_calls') stop_reason = 'tool_use';
  else if (choice.finish_reason === 'length') stop_reason = 'max_tokens';
  else if (choice.finish_reason === 'stop') stop_reason = 'end_turn';

  return {
    id: `msg_${openaiResp.id || Date.now()}`,
    type: 'message',
    role: 'assistant',
    model: requestModel,
    content,
    stop_reason,
    stop_sequence: null,
    usage: {
      input_tokens: openaiResp.usage?.prompt_tokens || 0,
      output_tokens: openaiResp.usage?.completion_tokens || 0,
    },
  };
}

// ─── OpenAI streaming → Anthropic streaming ──────────────────────────
function createStreamTranslator(requestModel, res) {
  let messageId = `msg_${Date.now()}`;
  let started = false;
  let contentIndex = 0;
  let currentToolCallId = null;
  let currentToolName = null;
  let toolArgsBuffer = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let textBuffer = '';

  function send(event, data) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  function startMessage() {
    if (started) return;
    started = true;
    send('message_start', {
      type: 'message_start',
      message: {
        id: messageId,
        type: 'message',
        role: 'assistant',
        model: requestModel,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: inputTokens, output_tokens: 0 },
      },
    });
  }

  return {
    processChunk(chunk) {
      const choice = chunk.choices?.[0];
      if (!choice) return;

      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens || inputTokens;
        outputTokens = chunk.usage.completion_tokens || outputTokens;
      }

      startMessage();
      const delta = choice.delta || {};

      // Text content — Z.AI puts thinking into reasoning_content, actual reply into content
      const textContent = delta.content || delta.reasoning_content || '';
      if (textContent) {
        if (!textBuffer) {
          // Start new text block
          send('content_block_start', {
            type: 'content_block_start',
            index: contentIndex,
            content_block: { type: 'text', text: '' },
          });
        }
        textBuffer += textContent;
        send('content_block_delta', {
          type: 'content_block_delta',
          index: contentIndex,
          delta: { type: 'text_delta', text: textContent },
        });
      }

      // Tool calls
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (tc.function?.name) {
            // Close text block if open
            if (textBuffer) {
              send('content_block_stop', { type: 'content_block_stop', index: contentIndex });
              contentIndex++;
              textBuffer = '';
            }

            // New tool_use block
            currentToolCallId = tc.id || `toolu_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            currentToolName = tc.function.name;
            toolArgsBuffer = tc.function.arguments || '';

            send('content_block_start', {
              type: 'content_block_start',
              index: contentIndex,
              content_block: {
                type: 'tool_use',
                id: currentToolCallId,
                name: currentToolName,
                input: {},
              },
            });

            if (toolArgsBuffer) {
              send('content_block_delta', {
                type: 'content_block_delta',
                index: contentIndex,
                delta: { type: 'input_json_delta', partial_json: toolArgsBuffer },
              });
            }
          } else if (tc.function?.arguments) {
            // Continue tool arguments
            toolArgsBuffer += tc.function.arguments;
            send('content_block_delta', {
              type: 'content_block_delta',
              index: contentIndex,
              delta: { type: 'input_json_delta', partial_json: tc.function.arguments },
            });
          }
        }
      }

      // Finish
      if (choice.finish_reason) {
        // Close current block
        if (textBuffer || currentToolCallId) {
          send('content_block_stop', { type: 'content_block_stop', index: contentIndex });
          contentIndex++;
        }

        let stop_reason = 'end_turn';
        if (choice.finish_reason === 'tool_calls') stop_reason = 'tool_use';
        else if (choice.finish_reason === 'length') stop_reason = 'max_tokens';

        send('message_delta', {
          type: 'message_delta',
          delta: { stop_reason, stop_sequence: null },
          usage: { output_tokens: outputTokens },
        });

        send('message_stop', { type: 'message_stop' });
      }
    },

    ensureStarted() {
      startMessage();
    },

    finish() {
      if (!started) {
        startMessage();
        send('content_block_start', {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        });
        send('content_block_stop', { type: 'content_block_stop', index: 0 });
      }
      send('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: outputTokens },
      });
      send('message_stop', { type: 'message_stop' });
    },
  };
}

// ─── Main proxy handler ──────────────────────────────────────────────
async function handleMessages(req, res, body) {
  const anthropicReq = JSON.parse(body);
  const isStreaming = anthropicReq.stream === true;

  // Extract API key from request headers (forwarded by SDK)
  const apiKey = req.headers['x-api-key']
    || req.headers['authorization']?.replace('Bearer ', '')
    || TARGET_API_KEY;

  // Build OpenAI request
  const openaiReq = {
    model: TARGET_MODEL,
    messages: translateMessages(anthropicReq.messages, anthropicReq.system),
    max_tokens: anthropicReq.max_tokens || 4096,
    stream: isStreaming,
  };

  // Temperature
  if (anthropicReq.temperature !== undefined) {
    openaiReq.temperature = anthropicReq.temperature;
  }

  // Tools
  const tools = translateTools(anthropicReq.tools);
  if (tools) openaiReq.tools = tools;

  // Tool choice
  if (anthropicReq.tool_choice) {
    if (anthropicReq.tool_choice.type === 'auto') openaiReq.tool_choice = 'auto';
    else if (anthropicReq.tool_choice.type === 'any') openaiReq.tool_choice = 'required';
    else if (anthropicReq.tool_choice.type === 'tool') {
      openaiReq.tool_choice = {
        type: 'function',
        function: { name: anthropicReq.tool_choice.name },
      };
    }
  }

  console.log(`[proxy] ${isStreaming ? 'STREAM' : 'SYNC'} → ${TARGET_MODEL} | msgs=${openaiReq.messages.length} tools=${tools?.length || 0}`);

  try {
    const resp = await fetch(TARGET_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(openaiReq),
    });

    if (!resp.ok) {
      const errorText = await resp.text();
      console.error(`[proxy] Z.AI error ${resp.status}: ${errorText}`);

      // Return Anthropic-format error
      res.writeHead(resp.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        type: 'error',
        error: {
          type: 'api_error',
          message: `Z.AI proxy error: ${errorText}`,
        },
      }));
      return;
    }

    if (isStreaming) {
      // SSE streaming response
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      const translator = createStreamTranslator(anthropicReq.model || TARGET_MODEL, res);
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6).trim();
              if (data === '[DONE]') continue;
              try {
                const chunk = JSON.parse(data);
                translator.processChunk(chunk);
              } catch (e) {
                // Skip unparseable chunks
              }
            }
          }
        }
      } catch (streamErr) {
        console.error(`[proxy] Stream error: ${streamErr.message}`);
      }

      // Process remaining buffer
      if (buffer.startsWith('data: ') && buffer.slice(6).trim() !== '[DONE]') {
        try {
          translator.processChunk(JSON.parse(buffer.slice(6)));
        } catch {}
      }

      res.end();
    } else {
      // Non-streaming response
      const openaiResp = await resp.json();
      const anthropicResp = translateResponse(openaiResp, anthropicReq.model || TARGET_MODEL);

      console.log(`[proxy] ← ${anthropicResp.stop_reason} | content=${anthropicResp.content.length} blocks`);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(anthropicResp));
    }
  } catch (err) {
    console.error(`[proxy] Fetch error: ${err.message}`);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      type: 'error',
      error: { type: 'api_error', message: `Proxy error: ${err.message}` },
    }));
  }
}

// ─── HTTP Server ─────────────────────────────────────────────────────
const server = createServer((req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // Health check
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', proxy: 'anthropic-to-openai', target: TARGET_URL, model: TARGET_MODEL }));
    return;
  }

  // Anthropic Messages endpoint
  if (req.method === 'POST' && (req.url === '/v1/messages' || req.url === '/messages')) {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => handleMessages(req, res, body).catch(err => {
      console.error(`[proxy] Handler error: ${err.message}`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        type: 'error',
        error: { type: 'api_error', message: err.message },
      }));
    }));
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found', path: req.url }));
});

server.listen(PROXY_PORT, '0.0.0.0', () => {
  console.log(`[proxy] ✓ Anthropic→OpenAI proxy running at http://0.0.0.0:${PROXY_PORT}`);
  console.log(`[proxy] Set ANTHROPIC_BASE_URL=http://host.docker.internal:${PROXY_PORT} (for Docker containers)`);
  console.log(`[proxy] Local test:  http://127.0.0.1:${PROXY_PORT}/v1/messages`);
});
