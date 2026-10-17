// Hjälpen i Studio: en text per flik i arbetsordningen, den aktiva fliken utfälld, ingen flik utan hjälp.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HELP, INTRO, TIPS, currentSection, helpHtml } from '../public/studio-help.js';
import { TABS } from '../public/studio-model.js';

test('varje flik i Studio har ett hjälpavsnitt, numrerade i arbetsordningen', () => {
  assert.deepEqual(HELP.map(h => h.n), [1, 2, 3, 4, 5, 6]);
  for (const t of TABS) assert.ok(HELP.some(h => h.match({ tab: t.id, view: '' })), t.id + ' saknar hjälp');
  for (const h of HELP) assert.ok(h.paragraphs.length && h.paragraphs.every(p => p.length > 40), h.id);
  assert.equal(currentSection({ tab: 'konfigurera', view: '' }), 'plan');
  assert.equal(currentSection({ tab: 'konfigurera', view: 'regler' }), 'regler');
  assert.equal(currentSection({ tab: 'konfigurera', view: 'ovriga' }), 'regler');
  assert.equal(currentSection({ tab: 'driftsattning', view: 'mat' }), 'driftsattning');
  assert.equal(currentSection({ tab: 'okänd', view: '' }), null);
});

test('panelens innehåll fäller ut den aktiva fliken och bär inledning och tips', () => {
  const html = helpHtml({ tab: 'data', view: '' });
  assert.ok(html.includes(INTRO) && html.includes(TIPS));
  assert.equal((html.match(/<details class="st-help-section" open>/g) || []).length, 1);
  assert.match(html, /<details class="st-help-section" open><summary><span class="st-help-n">2<\/span>Data<span class="st-help-here">du är här<\/span>/);
  assert.ok(html.includes('id="st-help-close"'));
  assert.equal((helpHtml({ tab: 'nonsens', view: '' }).match(/ open>/g) || []).length, 0, 'okänd flik: inget utfällt');
});
