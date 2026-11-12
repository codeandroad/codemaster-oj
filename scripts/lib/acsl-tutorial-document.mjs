import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readAcslTutorial } from '../check-acsl-tutorials.mjs';
import { validateLearningDocument } from '../../packages/domain/src/learning-document.mjs';

const source = new URL('../../content/acsl-tutorials/', import.meta.url);
const chapterFields = ['title', 'content', 'objective', 'checkpoint', 'checkpointAnswer'];
const localizedChapter = chapter => Object.fromEntries(chapterFields.map(field => [field, chapter[field]]));

// Editorial slugs are resolved and pinned by the receiving school's API. This
// document contains neither a school/account ID nor any formal answer material.
export async function readAcslBilingualTutorial() {
  const [en, zh, curriculum, practices] = await Promise.all([
    readAcslTutorial('en'), readAcslTutorial('zh'),
    readFile(new URL('curriculum.json', source), 'utf8').then(JSON.parse),
    readFile(new URL('intermediate/number-systems/practice-map.json', source), 'utf8').then(JSON.parse),
  ]);
  assert.equal(en.chapters.length, zh.chapters.length);
  assert.equal(practices.version, 1);
  assert.equal(practices.unitId, 'number-systems');
  assert.equal(practices.chapters.length, en.chapters.length);
  assert.equal(new Set(practices.chapters.map(chapter => chapter.key)).size, en.chapters.length);
  const expected = curriculum.units.find(unit => unit.id === practices.unitId).practiceReferences;
  const key = reference => `${reference.paperSlug}/${reference.questionId}`;
  const assigned = practices.chapters.flatMap(chapter => chapter.references);
  assert.equal(new Set(assigned.map(key)).size, assigned.length, 'Each sample question has one primary lesson');
  assert.deepEqual(assigned.map(key).sort(), expected.map(key).sort(), 'Map every number-systems reference');
  const document = {
    ...en,
    localizations: {
      en: { title: en.title, description: en.description },
      zh: { title: zh.title, description: zh.description },
    },
    chapters: en.chapters.map((chapter, position) => {
      const mapping = practices.chapters[position];
      assert.equal(mapping.position, position);
      for (const ref of mapping.references) assert.deepEqual(Object.keys(ref).sort(), ['paperSlug', 'questionId']);
      return {
        ...chapter,
        localizations: { en: localizedChapter(chapter), zh: localizedChapter(zh.chapters[position]) },
        acslLinks: mapping.references.map(reference => ({ ...reference, kind: 'question' })),
      };
    }),
  };
  const validated = validateLearningDocument(document);
  assert.deepEqual(validated.localizations, document.localizations, 'Keep both course translations during import');
  for (const [index, chapter] of validated.chapters.entries()) {
    assert.deepEqual(chapter.localizations, document.chapters[index].localizations, 'Keep both chapter translations during import');
    assert.deepEqual(chapter.acslLinks, document.chapters[index].acslLinks, 'Keep structured practice references during import');
  }
  return document;
}
