// Legacy unit-level validation and reconciliation helpers. New imports use one unified course.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { assertTutorialUnit, readAcslTutorial, checkAcslTutorials, parseTutorialOptions } from './check-acsl-tutorials.mjs';
import { readAcslBilingualTutorial } from './lib/acsl-tutorial-document.mjs';

export function tutorialJournalKey({ origin, username, language, unitId = 'number-systems' }) {
  assertTutorialUnit(unitId);
  const original = `${origin}\0${username}\0${language}`;
  // Keep the existing number-systems journals usable, including monolingual drafts.
  return createHash('sha256').update(unitId === 'number-systems' ? original : `${original}\0${unitId}`).digest('hex');
}

const referenceIdentity = ({ paperSlug, kind, questionId, versionId }) => ({ paperSlug, kind,
  ...(questionId ? { questionId } : {}), ...(versionId ? { versionId } : {}) });
const chapterReferences = course => course.chapters.map(chapter => (chapter.acslLinks ?? []).map(referenceIdentity));
export function matchesTutorialDraft(course, document, state = {}) {
  return course.canEdit === true && !course.published && !course.archived
    && (!state.courseId || course.id === state.courseId)
    && ['title', 'description', 'category', 'estimatedMinutes', 'difficulty', 'coverKey'].every(field => course[field] === document[field])
    && isDeepStrictEqual(course.localizations ?? {}, document.localizations ?? {})
    && isDeepStrictEqual(course.sections ?? [], document.sections ?? [])
    && course.chapters?.length === document.chapters.length
    && (!state.chapterIds || isDeepStrictEqual(course.chapters.map(chapter => chapter.id), state.chapterIds))
    && (!state.acslReferences || isDeepStrictEqual(chapterReferences(course), state.acslReferences))
    && course.chapters.every((chapter, i) => {
      const expected = document.chapters[i];
      const refs = (chapter.acslLinks ?? []).map((reference, position) => {
        const input = expected.acslLinks?.[position];
        return referenceIdentity({ ...reference, versionId: input?.versionId ? reference.versionId : undefined });
      });
      return (chapter.sectionKey ?? null) === (expected.sectionKey ?? null)
        && ['title', 'content', 'objective', 'checkpoint', 'checkpointAnswer'].every(field => chapter[field] === expected[field])
        && isDeepStrictEqual(chapter.localizations ?? {}, expected.localizations ?? {})
        && isDeepStrictEqual(refs, expected.acslLinks ?? [])
        && !chapter.problems?.length && !chapter.paper4Links?.length;
    });
}

export async function importAcslTutorials(argv = process.argv.slice(2)) {
  const options = parseTutorialOptions(argv, { importing: true });
  const { unitId, language } = options;
  const document = language === 'bilingual' ? await readAcslBilingualTutorial(unitId) : await readAcslTutorial(language, unitId);
  console.log(JSON.stringify(await checkAcslTutorials(unitId)));
  if (!options.import) {
    console.log(`Validated only (${unitId}, ${language}). Unit validation only. Use scripts/import-acsl-course.mjs for a unified course; use scripts/merge-acsl-tutorials.mjs to consolidate existing drafts.`);
    return;
  }
  throw Error('Individual topic imports are retired. Use scripts/import-acsl-course.mjs for one unified course, or scripts/merge-acsl-tutorials.mjs to preserve existing topic drafts and progress.');

}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await importAcslTutorials();
