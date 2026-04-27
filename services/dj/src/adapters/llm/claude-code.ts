/**
 * Claude Code LLM adapter — uses the local `claude` CLI subscription.
 *
 * Two modes (auto-detected):
 *
 *   Relay mode (CLAUDE_RELAY_URL set) — HTTP call to a host-side relay server
 *     that spawns `claude -p`. Used when running inside Docker where the
 *     binary is not available. Start the relay with:
 *       node scripts/claude-relay.mjs
 *     and set CLAUDE_RELAY_URL=http://host.docker.internal:3099 in the
 *     DJ container (docker-compose.override.yml).
 *
 *   Direct mode (CLAUDE_RELAY_URL not set) — spawns `claude -p` as a
 *     subprocess. Works when the DJ worker runs directly on the host.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { LlmMessage, LlmOptions, LlmResult } from './openrouter.js';

const execFileAsync = promisify(execFile);

/** JSON shape returned by `claude --output-format json` */
interface ClaudeCliResult {
  result?: string;
  is_error?: boolean;
  cost_usd?: number;
}

// ── Relay mode ────────────────────────────────────────────────────────────────

async function relayComplete(
  relayUrl: string,
  messages: LlmMessage[],
  options: LlmOptions,
): Promise<LlmResult> {
  const res = await fetch(`${relayUrl}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, model: options.model }),
    signal: AbortSignal.timeout(180_000),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`claude-relay ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json() as { text?: string; error?: string };
  if (!data.text) throw new Error(`claude-relay returned no text: ${JSON.stringify(data).slice(0, 200)}`);
  return { text: data.text };
}

// ── Direct subprocess mode ────────────────────────────────────────────────────

async function directComplete(
  messages: LlmMessage[],
  options: LlmOptions,
): Promise<LlmResult> {
  const systemParts = messages.filter((m) => m.role === 'system').map((m) => m.content);
  const userParts = messages.filter((m) => m.role !== 'system').map((m) => m.content);

  const prompt = userParts.join('\n\n');
  if (!prompt) throw new Error('claude-code: no user message provided');

  const args: string[] = [
    '--print',
    '--output-format', 'json',
    '--dangerously-skip-permissions',
  ];

  if (systemParts.length > 0) {
    args.push('--system-prompt', systemParts.join('\n\n'));
  }

  if (options.model && !options.model.includes('/')) {
    args.push('--model', options.model);
  }

  args.push(prompt);

  const claudeBin = process.env.CLAUDE_BIN ?? 'claude';

  let stdout: string;
  try {
    const out = await execFileAsync(claudeBin, args, {
      timeout: 180_000,
      maxBuffer: 4 * 1024 * 1024,
      env: {
        ...process.env,
        PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? ''}`,
      },
    });
    stdout = out.stdout;
  } catch (err: unknown) {
    const e = err as { stderr?: string; message?: string };
    throw new Error(
      `claude-code subprocess failed: ${e.message ?? 'unknown'}${e.stderr ? ` — ${e.stderr.slice(0, 200)}` : ''}`,
    );
  }

  let parsed: ClaudeCliResult;
  try {
    parsed = JSON.parse(stdout) as ClaudeCliResult;
  } catch {
    const lastJson = stdout.trim().split('\n').reverse().find((l) => l.startsWith('{'));
    if (!lastJson) throw new Error(`claude-code: cannot parse output: ${stdout.slice(0, 200)}`);
    parsed = JSON.parse(lastJson) as ClaudeCliResult;
  }

  if (parsed.is_error || !parsed.result) {
    throw new Error(`claude-code error or empty result: ${JSON.stringify(parsed).slice(0, 200)}`);
  }

  return { text: parsed.result.trim() };
}

// ── Public entry point ────────────────────────────────────────────────────────

export async function claudeCodeLlmComplete(
  messages: LlmMessage[],
  options: LlmOptions = {},
): Promise<LlmResult> {
  const relayUrl = process.env.CLAUDE_RELAY_URL;
  if (relayUrl) {
    return relayComplete(relayUrl, messages, options);
  }
  return directComplete(messages, options);
}
