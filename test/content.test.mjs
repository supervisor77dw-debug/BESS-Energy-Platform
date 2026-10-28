// Inhaltliche Leitplanken der öffentlichen Seiten (Textprüfung AW-BESS-STROMKAI-CONTENT-DESIGN-006).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import * as P from '../src/public/pages.mjs';

const pages = { start: P.home(), unternehmen: P.unternehmen(), technologie: P.technologie(), standortentwicklung: P.standortentwicklung(), eigentuemer: P.eigentuemer(), investoren: P.investoren(), kommunen: P.kommunen(), impressum: P.impressum(), datenschutz: P.datenschutz() };
const text = (h) => String(h).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('keine unzulässigen Versprechen oder unbelegten Aussagen', () => {
  const verboten = [/risikolos/i, /geräuschlos/i, /vollständig unversiegelt/i, /garantierte? (Rendite|Pacht|Vergütung)/i, /Mehrere Standorte befinden sich/i, /bündelt Erfahrung/i, /statt Anlagen abzuregeln/i, /zwanzig Jahre und länger/i, /\d+(\.\d+)?\s?(€|EUR|Euro)\s?(je|pro)\s?(ha|Hektar)/i, /\d+\s?%\s?Rendite/i];
  for (const [name, h] of Object.entries(pages)) for (const re of verboten) assert.ok(!re.test(text(h)), `${name}: ${re}`);
});

test('jedes Bild der Bildwelt ist als Visualisierung gekennzeichnet', () => {
  for (const [name, h] of Object.entries(pages)) {
    const s = String(h);
    const figures = (s.match(/<figure class="(photo|photo-band)[^"]*">[\s\S]*?<\/figure>/g) || []);
    for (const f of figures) assert.match(f, /Visualisierung/, `${name}: Bild ohne Kennzeichnung`);
    if (s.includes('hero-photo')) assert.match(s, /Visualisierung einer Beispielanlage/);
  }
});

test('Eigentümerseite nennt Wahlrecht, Vorkaufsrecht und Beendigung offen', () => {
  const t = text(pages.eigentuemer);
  assert.match(t, /entscheidet der Projektentwickler/);
  assert.match(t, /Vorkaufsrecht/);
  assert.match(t, /vier Wochen Frist/);
  assert.match(t, /Bauphasenvergütung/);
});

test('Kommunen: Notstrom nur als gesonderte Option', () => {
  const t = text(pages.kommunen);
  assert.match(t, /schaltet sich bei einem Netzausfall ab/);
  assert.match(t, /nicht als Standardleistung/);
});

test('alle Bilddateien laut Manifest vorhanden', () => {
  const m = JSON.parse(readFileSync(new URL('../static/img/v2/manifest.json', import.meta.url), 'utf8'));
  const keys = Object.keys(m).filter((k) => !k.startsWith('_'));
  assert.equal(keys.length, 8);
  for (const k of keys) for (const kind of ['d', 'm']) for (const w of m[k][kind]) for (const ext of ['avif', 'webp'])
    assert.ok(existsSync(new URL(`../static/img/v2/${k}-${kind}-${w}.${ext}`, import.meta.url)), `${k}-${kind}-${w}.${ext}`);
});
