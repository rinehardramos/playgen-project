#!/usr/bin/env node
/**
 * Claude Code HTTP relay — receives LLM requests from the DJ service and
 * fulfils them via `claude -p` using the authenticated subscription.
 *
 * First-time setup:
 *   docker compose exec -it claude-code claude   # follow login prompts
 *
 * Routes:
 *   GET  /health    — liveness probe
 *   POST /generate  — { messages: [{role, content}], model? } → { text }
 */

import http from 'http';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const PORT = Number(process.env.PORT ?? 3099);

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method !== 'POST' || req.url !== '/generate') {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  let body = '';
  for await (const chunk of req) body += chunk;

  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid JSON' }));
    return;
  }

  const { messages = [], model } = payload;

  const systemParts = messages.filter(m => m.role === 'system').map(m => m.content);
  const userParts   = messages.filter(m => m.role !== 'system').map(m => m.content);
  const prompt = userParts.join('\n\n');

  if (!prompt) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'No user message' }));
    return;
  }

  const args = [
    '--print',
    '--output-format', 'json',
    '--dangerously-skip-permissions',
  ];

  if (systemParts.length > 0) {
    args.push('--system-prompt', systemParts.join('\n\n'));
  }

  // Only pass non-OpenRouter model strings (claude-sonnet-4-6, sonnet, etc.)
  if (model && !model.includes('/')) {
    args.push('--model', model);
  }

  args.push(prompt);

  console.log(`[relay] → claude -p  prompt=${prompt.length}c  model=${model ?? 'default'}`);

  try {
    const { stdout } = await execFileAsync('claude', args, {
      timeout: 180_000,
      maxBuffer: 4 * 1024 * 1024,
    });

    let parsed;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      // output-format json sometimes emits extra lines — grab last JSON object
      const lastJson = stdout.trim().split('\n').reverse().find(l => l.startsWith('{'));
      if (!lastJson) throw new Error(`Cannot parse output: ${stdout.slice(0, 200)}`);
      parsed = JSON.parse(lastJson);
    }

    if (parsed.is_error || !parsed.result) {
      throw new Error(`claude error: ${JSON.stringify(parsed).slice(0, 200)}`);
    }

    console.log(`[relay] ✓ ${parsed.result.length}c  cost=$${parsed.cost_usd ?? '?'}`);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ text: parsed.result.trim(), cost_usd: parsed.cost_usd }));
  } catch (err) {
    const msg = err.message ?? String(err);
    // Surface login-required error clearly
    if (msg.includes('not logged in') || msg.includes('authentication') || msg.includes('401')) {
      console.error('[relay] ✗ Not logged in — run: docker compose exec -it claude-code claude');
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'claude-code not authenticated. Run: docker compose exec -it claude-code claude' }));
    } else {
      console.error(`[relay] ✗ ${msg}`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: msg }));
    }
  }
});

server.listen(PORT, () => {
  console.log(`[claude-relay] Listening on :${PORT}`);
  console.log('[claude-relay] First-time login: docker compose exec -it claude-code claude');
});
