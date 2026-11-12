import assert from 'node:assert/strict';
import { assertTutorialUnit, readAcslTutorial, readTutorialPracticeMap } from '../check-acsl-tutorials.mjs';
import { validateLearningDocument } from '../../packages/domain/src/learning-document.mjs';

const chapterFields = ['title', 'content', 'objective', 'checkpoint', 'checkpointAnswer'];
const localizedChapter = chapter => Object.fromEntries(chapterFields.map(field => [field, chapter[field]]));

// Editorial slugs are resolved and pinned by the receiving school's API. This
// document contains neither a school/account ID nor any formal answer material.
export async function readAcslBilingualTutorial(unitId = 'number-systems') {
  assertTutorialUnit(unitId);
  const [en, zh, practices] = await Promise.all([
    readAcslTutorial('en', unitId), readAcslTutorial('zh', unitId),
    readTutorialPracticeMap(unitId),
  ]);
  assert.equal(en.chapters.length, zh.chapters.length);
  assert.equal(practices.chapters.length, en.chapters.length);
  const document = {
    ...en,
    localizations: {
      en: { title: en.title, description: en.description },
      zh: { title: zh.title, description: zh.description },
    },
    chapters: en.chapters.map((chapter, position) => {
      const mapping = practices.chapters[position];
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
