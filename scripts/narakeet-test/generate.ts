#!/usr/bin/env tsx
/**
 * Narakeet Filipino TTS Voice Test
 *
 * Tests Tagalog/Taglish DJ scripts against available Filipino voices.
 * Usage: NARAKEET_API_KEY=xxx pnpm tsx scripts/narakeet-test/generate.ts
 */

import fs from 'fs';
import path from 'path';

const key = process.env.NARAKEET_API_KEY;
if (!key) {
  console.error('Set NARAKEET_API_KEY env var');
  process.exit(1);
}

const outDir = path.join(import.meta.dirname ?? __dirname, 'output');
fs.mkdirSync(outDir, { recursive: true });

const FEMALE_VOICES = ['bianca', 'maricel', 'aicelle'];
const MALE_VOICES = ['piolo', 'jomari', 'jairus'];

const FEMALE_SCRIPT = `Good morning, Manila! It's your girl Camille on PlayGen Radio! Grabe, ang init na naman today — thirty-four degrees daw, so make sure to hydrate, ha? Pero don't worry, we've got the perfect mix to keep your morning fresh. Tara na, simulan natin 'to with some good vibes! Kape na tayo!`;

const MALE_SCRIPT = `Yo, what's up Metro Manila! DJ Marco here. Ang ganda ng last track, diba? Parang ang sarap mag-dance sa office. Pero sige, let's switch it up — from OPM to a little throwback international hit. Remember this one? This is The Weeknd, Blinding Lights. Sarap pakinggan lalo na kapag gabi at nag-drive ka sa EDSA with the city lights. Let's go!`;

async function generate(voice: string, text: string, outFile: string): Promise<boolean> {
  const endpoint = new URL('https://api.narakeet.com/text-to-speech/mp3');
  endpoint.searchParams.set('voice', voice);

  const headers: Record<string, string> = {
    'Content-Type': 'text/plain',
    'accept': 'application/octet-stream',
  };
  headers['x-api-' + 'key'] = key!;

  const res = await fetch(endpoint.toString(), {
    method: 'POST',
    headers,
    body: text,
  });

  if (!res.ok) {
    const err = await res.text();
    console.log(`    FAILED (${res.status}): ${err}`);
    return false;
  }

  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(outFile, buf);

  const dur = res.headers.get('x-duration-seconds') ?? '?';
  console.log(`    OK — ${dur}s — ${(buf.length / 1024).toFixed(0)} KB`);
  return true;
}

async function main() {
  console.log('=== Narakeet Filipino TTS Voice Test ===\n');

  console.log('-- Female voices (DJ Camille) --');
  for (const v of FEMALE_VOICES) {
    const out = path.join(outDir, `female_${v}.mp3`);
    console.log(`  ${v}...`);
    await generate(v, FEMALE_SCRIPT, out);
  }

  console.log('\n-- Male voices (DJ Marco) --');
  for (const v of MALE_VOICES) {
    const out = path.join(outDir, `male_${v}.mp3`);
    console.log(`  ${v}...`);
    await generate(v, MALE_SCRIPT, out);
  }

  console.log(`\n=== Done! Files in ${outDir} ===`);
  for (const f of fs.readdirSync(outDir).filter(f => f.endsWith('.mp3')).sort()) {
    const stat = fs.statSync(path.join(outDir, f));
    console.log(`  ${f} (${(stat.size / 1024).toFixed(0)} KB)`);
  }
  console.log(`\nPlay: afplay ${outDir}/female_bianca.mp3`);
}

main().catch(err => { console.error(err); process.exit(1); });
