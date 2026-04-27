/**
 * Claude Code LLM adapter — spawns `claude -p` CLI to use the local subscription.
 *
 * Only works where the `claude` binary is installed and authenticated
 * (local dev). In production Docker, set LLM_BACKEND=openrouter instead.
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
  duration_ms?: number;
}

export async function claudeCodeLlmComplete(
  messages: LlmMessage[],
  options: LlmOptions = {},
): Promise<LlmResult> {
  const systemParts = messages.filter((m) => m.role === 'system').map((m) => m.content);
  const userParts = messages.filter((m) => m.role !== 'system').map((m) => m.content);

  const prompt = userParts.join('\n\n');
  if (!prompt) throw new Error('claude-code: no user message provided');

  const args: string[] = [
    '--print',
    '--output-format', 'json',
    '--dangerously-skip-permissions', // non-interactive, no workspace dialog
  ];

  if (systemParts.length > 0) {
    args.push('--system-prompt', systemParts.join('\n\n'));
  }

  if (options.model && !options.model.includes('/')) {
    // Pass through non-OpenRouter model strings (e.g. 'sonnet', 'claude-sonnet-4-6')
    args.push('--model', options.model);
  }

  args.push(prompt);

  const claudeBin = process.env.CLAUDE_BIN ?? 'claude';

  let stdout: string;
  try {
    const out = await execFileAsync(claudeBin, args, {
      timeout: options.maxTokens ? 180_000 : 120_000,
      maxBuffer: 4 * 1024 * 1024, // 4 MB
      env: {
        ...process.env,
        PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? ''}`,
      },
    });
    stdout = out.stdout;
  } catch (err: unknown) {
    const e = err as { stderr?: string; message?: string };
    throw new Error(
      `claude-code subprocess failed: ${e.message ?? 'unknown error'}${e.stderr ? ` — ${e.stderr.slice(0, 200)}` : ''}`,
    );
  }

  let parsed: ClaudeCliResult;
  try {
    parsed = JSON.parse(stdout) as ClaudeCliResult;
  } catch {
    // --output-format json sometimes streams extra lines; try last JSON line
    const lastJson = stdout.trim().split('\n').reverse().find((l) => l.startsWith('{'));
    if (!lastJson) throw new Error(`claude-code: could not parse CLI output: ${stdout.slice(0, 200)}`);
    parsed = JSON.parse(lastJson) as ClaudeCliResult;
  }

  if (parsed.is_error || !parsed.result) {
    throw new Error(`claude-code returned error or empty result: ${JSON.stringify(parsed).slice(0, 200)}`);
  }

  return {
    text: parsed.result.trim(),
    usage: parsed.cost_usd !== undefined
      ? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
      : undefined,
  };
}
