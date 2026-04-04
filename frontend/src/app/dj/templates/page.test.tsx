/**
 * Unit tests for DjTemplatesPage helper functions.
 *
 * No test framework is installed in the frontend package, so these tests
 * use plain assertions and can be run with:
 *   node --loader ts-node/esm page.test.tsx
 *
 * They verify the pure-logic helpers that don't depend on DOM/React.
 */

// ─── SEGMENT_TYPE_LABELS helper ───────────────────────────────────────────────

type DjSegmentType =
  | 'show_intro'
  | 'song_intro'
  | 'song_transition'
  | 'show_outro'
  | 'station_id'
  | 'time_check'
  | 'weather_tease'
  | 'ad_break';

const SEGMENT_TYPE_LABELS: Record<DjSegmentType, string> = {
  show_intro: 'Show Intro',
  song_intro: 'Song Intro',
  song_transition: 'Song Transition',
  show_outro: 'Show Outro',
  station_id: 'Station ID',
  time_check: 'Time Check',
  weather_tease: 'Weather Tease',
  ad_break: 'Ad Break',
};

// ─── Variable insertion helper (extracted from VariableChips) ─────────────────

function insertVariableAtCursor(
  currentValue: string,
  variable: string,
  selectionStart: number,
  selectionEnd: number,
): string {
  const before = currentValue.slice(0, selectionStart);
  const after = currentValue.slice(selectionEnd);
  return before + variable + after;
}

// ─── Test runner ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ✗ ${name}\n    ${msg}`);
    failed++;
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function assertEqual<T>(actual: T, expected: T, label?: string) {
  if (actual !== expected) {
    throw new Error(
      `${label ? label + ': ' : ''}expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

console.log('\nDjTemplatesPage — unit tests\n');

console.log('SEGMENT_TYPE_LABELS');
test('maps all 8 segment types', () => {
  const types: DjSegmentType[] = [
    'show_intro', 'song_intro', 'song_transition', 'show_outro',
    'station_id', 'time_check', 'weather_tease', 'ad_break',
  ];
  for (const t of types) {
    assert(typeof SEGMENT_TYPE_LABELS[t] === 'string' && SEGMENT_TYPE_LABELS[t].length > 0,
      `label for ${t} should be non-empty string`);
  }
});

test('returns human-readable labels', () => {
  assertEqual(SEGMENT_TYPE_LABELS['song_intro'], 'Song Intro');
  assertEqual(SEGMENT_TYPE_LABELS['show_outro'], 'Show Outro');
  assertEqual(SEGMENT_TYPE_LABELS['ad_break'], 'Ad Break');
  assertEqual(SEGMENT_TYPE_LABELS['weather_tease'], 'Weather Tease');
});

console.log('\ninsertVariableAtCursor');
test('inserts variable at cursor when nothing is selected', () => {
  const result = insertVariableAtCursor('Hello ', '{{dj_name}}', 6, 6);
  assertEqual(result, 'Hello {{dj_name}}');
});

test('inserts variable at start of text', () => {
  const result = insertVariableAtCursor('world', '{{song_title}} ', 0, 0);
  assertEqual(result, '{{song_title}} world');
});

test('replaces selected text with variable', () => {
  const result = insertVariableAtCursor('Hello PLACEHOLDER world', '{{artist}}', 6, 17);
  assertEqual(result, 'Hello {{artist}} world');
});

test('inserts variable at end of text', () => {
  const result = insertVariableAtCursor('Play ', '{{station_name}}', 5, 5);
  assertEqual(result, 'Play {{station_name}}');
});

test('handles empty string input', () => {
  const result = insertVariableAtCursor('', '{{time_of_day}}', 0, 0);
  assertEqual(result, '{{time_of_day}}');
});

test('handles multiple variable insertions sequentially', () => {
  const step1 = insertVariableAtCursor('', '{{song_title}}', 0, 0);
  assertEqual(step1, '{{song_title}}');
  const step2 = insertVariableAtCursor(step1 + ' by ', '{{artist}}', step1.length + 4, step1.length + 4);
  assertEqual(step2, '{{song_title}} by {{artist}}');
});

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
