/**
 * promptGuard — defense-in-depth against LLM prompt injection.
 *
 * The DJ service feeds user-controlled fields (persona name, backstory,
 * catchphrases, custom templates, listener shoutouts, station metadata) into
 * Anthropic / OpenAI / OpenRouter prompts. Any of those fields is a vector
 * for "ignore previous instructions" style attacks, jailbreaks, or
 * cross-tenant exfiltration. This module provides:
 *
 *   1. sanitizeUntrusted(): strip dangerous unicode + clamp length.
 *   2. wrapUntrusted():     wrap strings in clearly-delimited tags so the
 *                           LLM treats them as data, not instructions.
 *   3. detectInjection():   regex heuristic — returns a list of matched
 *                           rules (empty array = clean). Used for logging
 *                           and metrics; the prompt is still sent (with
 *                           sanitized + wrapped content) so legitimate
 *                           edge-case inputs aren't refused outright.
 *   4. scrubLlmOutput():    scrub LLM responses for accidental secret
 *                           leakage (JWTs, API keys, DB DSNs).
 *
 * This is layered with the existing review-gate that holds AI-generated
 * content for human approval before publication — see services/dj/README.
 */

// ── Unicode hygiene ──────────────────────────────────────────────────────────

// Bidi override + isolate codepoints (U+202A–U+202E, U+2066–U+2069).
// These render text in a different visual order than its byte order, a
// classic smuggling vector ("Trojan Source", CVE-2021-42574).
const BIDI_RE = /[\u202A-\u202E\u2066-\u2069]/g;

// Zero-width characters (ZWJ, ZWNJ, ZWSP, BOM, word joiner). Often used
// to fingerprint, smuggle instructions past naive filters, or hide payloads.
const ZERO_WIDTH_RE = /[\u200B-\u200F\u2028-\u202F\uFEFF]/g;

// ASCII control chars except \t \n \r — anything that shouldn't appear in
// user-generated text and can break prompt structure.
const CONTROL_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

/** Strip dangerous unicode + clamp length. Safe to call on every untrusted field. */
export function sanitizeUntrusted(input: string | null | undefined, maxLen = 2000): string {
  if (!input) return '';
  const cleaned = String(input)
    .normalize('NFKC')
    .replace(BIDI_RE, '')
    .replace(ZERO_WIDTH_RE, '')
    .replace(CONTROL_RE, '');
  return cleaned.length > maxLen ? cleaned.slice(0, maxLen) : cleaned;
}

/**
 * Wrap untrusted content in clearly-delimited tags so the LLM treats it as
 * data rather than instructions. Sanitizes first, then escapes any literal
 * occurrences of the delimiter inside the input so an attacker can't break out.
 */
export function wrapUntrusted(label: string, content: string | null | undefined, maxLen = 2000): string {
  const safe = sanitizeUntrusted(content, maxLen)
    // If a user crafts a string containing our closing tag, neutralize it.
    .replace(/<\/?untrusted[^>]*>/gi, '');
  return `<untrusted source="${label}">\n${safe}\n</untrusted>`;
}

// ── Injection heuristics ─────────────────────────────────────────────────────

interface InjectionRule {
  name: string;
  pattern: RegExp;
}

// Each rule is a known prompt-injection signature. Add liberally — false
// positives here only flip a flag, they do not block content.
const INJECTION_RULES: InjectionRule[] = [
  { name: 'ignore-instructions',   pattern: /ignore\s+(all\s+)?(previous|above|prior)\s+(instructions|prompts|rules)/i },
  { name: 'override-system',       pattern: /(disregard|forget|override|bypass)\s+(the\s+)?(system|developer|prior)\s+(prompt|message|instructions)/i },
  { name: 'role-confusion',        pattern: /(^|\n)\s*(system|assistant|developer)\s*[:>]/i },
  { name: 'role-impersonation',    pattern: /you\s+are\s+(now|actually)\s+(a|an)\s+/i },
  { name: 'jailbreak-dan',         pattern: /\b(DAN|do\s+anything\s+now|unfiltered\s+mode|developer\s+mode)\b/i },
  { name: 'reveal-prompt',         pattern: /(reveal|print|show|output|repeat)\s+(the\s+)?(system|hidden|initial|original)\s+(prompt|instructions|message)/i },
  { name: 'tool-injection',        pattern: /<\s*(tool_use|function_call|tool_call)\b/i },
  { name: 'fake-delimiters',       pattern: /<\/?(system|instructions|admin)>/i },
  { name: 'secret-exfil-hint',     pattern: /(api[_\-\s]?key|access[_\-\s]?token|password|credential)/i },
  { name: 'data-url',              pattern: /data:[^,\s]+;base64,[A-Za-z0-9+/=]{200,}/ },
  { name: 'long-base64-blob',      pattern: /[A-Za-z0-9+/=]{500,}/ },
  { name: 'cross-tenant',          pattern: /(other|another|all)\s+(company|tenant|station|user)s?\b/i },
];

export interface InjectionScan {
  flagged: boolean;
  matchedRules: string[];
}

export function detectInjection(input: string | null | undefined): InjectionScan {
  if (!input) return { flagged: false, matchedRules: [] };
  const matched = INJECTION_RULES.filter((r) => r.pattern.test(input)).map((r) => r.name);
  return { flagged: matched.length > 0, matchedRules: matched };
}

// ── Output scrubbing ─────────────────────────────────────────────────────────

// JWT-shaped tokens (eyJ... base64 segments).
const JWT_RE = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
// Common API key prefixes.
const API_KEY_RE = /\b(sk|pk|xoxb|xoxp|ghp|ghs|glpat)-[A-Za-z0-9_-]{20,}\b/g;
// Postgres / generic DSNs.
const DSN_RE = /(postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s'"<>]+/gi;

const REDACTED = '[REDACTED]';

export function scrubLlmOutput(output: string): string {
  return output
    .replace(JWT_RE, REDACTED)
    .replace(API_KEY_RE, REDACTED)
    .replace(DSN_RE, REDACTED);
}
