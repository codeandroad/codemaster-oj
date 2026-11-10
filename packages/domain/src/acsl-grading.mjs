import { fail } from './security.mjs';
import { validateAcslDiagrams } from './acsl-diagrams.mjs';

export function selectedOptions(question, value, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || value.length > question.options.length || (!allowEmpty && !value.length)) {
    fail(400, 'INVALID_ANSWER', 'Select an answer.');
  }
  const allowed = new Set(question.options.map(option => option.id));
  if (value.some(id => typeof id !== 'string' || !allowed.has(id)) || new Set(value).size !== value.length ||
      (question.type === 'single' && value.length > 1)) {
    fail(400, 'INVALID_ANSWER', 'Check the selected options.');
  }
  return [...value].sort();
}

export function gradeAnswer(question, value) {
  const selected = selectedOptions(question, value);
  const correct = [...question.correctOptionIds].sort();
  return selected.length === correct.length && selected.every((id, index) => id === correct[index]);
}

function text(value, maxLength) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

function localizedText(value, maxLength) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    text(value.en, maxLength) && text(value.zh, maxLength);
}

export function validatePaperDefinition(content) {
  if (content?.schemaVersion !== 1 || !text(content.slug, 100) || !/^[a-z0-9-]{3,100}$/.test(content.slug) ||
      !localizedText(content.title, 200) || !['Elementary', 'Junior', 'Intermediate', 'Senior'].includes(content.division) ||
      !text(content.season, 9) || !/^\d{4}-\d{4}$/.test(content.season) ||
      Number(content.season.slice(5)) !== Number(content.season.slice(0, 4)) + 1 ||
      !Number.isInteger(content.round) || content.round < 1 || content.round > 100 ||
      (content.roundLabel !== undefined && !localizedText(content.roundLabel, 100)) ||
      !Array.isArray(content.questions) || !content.questions.length || content.questions.length > 100) {
    throw new Error('Invalid ACSL paper definition.');
  }
  for (const question of content.questions) {
    if (!question || !text(question.id, 40) || !/^[a-z0-9-]{1,40}$/.test(question.id) ||
        !Number.isInteger(question.number) || question.number < 1 || question.number > 1000 ||
        !['single', 'multiple'].includes(question.type) || !localizedText(question.topic, 200) ||
        !localizedText(question.statement, 100000) || !localizedText(question.explanation, 100000) ||
        !Array.isArray(question.options) || question.options.length < 2 || question.options.length > 20 ||
        question.options.some(option => !option || !text(option.id, 40) || !/^[A-Za-z0-9-]+$/.test(option.id) ||
          !localizedText(option.text, 10000))) {
      throw new Error('Invalid ACSL question definition.');
    }
    if (new Set(question.options.map(option => option.id)).size !== question.options.length) {
      throw new Error('Duplicate ACSL option IDs.');
    }
    selectedOptions(question, question.correctOptionIds);
    validateAcslDiagrams(question.statementDiagrams);
    validateAcslDiagrams(question.explanationDiagrams);
    for (const option of question.options) validateAcslDiagrams(option.diagrams);
  }
  if (new Set(content.questions.map(question => question.id)).size !== content.questions.length ||
      new Set(content.questions.map(question => question.number)).size !== content.questions.length) {
    throw new Error('Duplicate ACSL question IDs or numbers.');
  }
  const programming = content.programming;
  if (programming == null && content.division !== 'Elementary' || programming != null && (
      !text(programming.id, 100) || !/^[a-z0-9-]+$/.test(programming.id) ||
      !text(programming.statementZh, 100000) || !programming.definition ||
      typeof programming.definition !== 'object' || Array.isArray(programming.definition))) {
    throw new Error('Invalid ACSL programming definition.');
  }
  if (programming && programming.definition.referenceCode == null &&
      (programming.testProvenance !== 'official' || !programming.source ||
        typeof programming.source !== 'object' || Array.isArray(programming.source))) {
    throw new Error('Programming cases without a reference solution require official source provenance.');
  }
  paperAssetPurposes(content);
  validateAcslDiagrams(programming?.statementDiagrams);
  if (Buffer.byteLength(JSON.stringify(content)) > 2000000) {
    throw new Error('ACSL paper package exceeds 2 MB.');
  }
  return content;
}

// The same bytes must never be exposed as a statement and also contain a solution.
export function paperAssetPurposes(content) {
  const assets = content.assets ?? [];
  if (!Array.isArray(assets) || assets.length > 128) throw new Error('Invalid ACSL asset list.');
  const catalog = new Map();
  for (const asset of assets) {
    if (!asset || !text(asset.id, 100) || !/^[A-Za-z0-9-]+$/.test(asset.id) || catalog.has(asset.id) ||
        !text(asset.path, 500) || asset.path.startsWith('/') || asset.path.includes('\\') ||
        asset.path.split('/').some(part => !part || part === '.' || part === '..') ||
        !/^[a-f0-9]{64}$/.test(asset.sha256 ?? '') || asset.mimeType !== 'image/png' ||
        !Number.isInteger(asset.width) || asset.width < 1 || asset.width > 12000 ||
        !Number.isInteger(asset.height) || asset.height < 1 || asset.height > 12000 ||
        asset.width * asset.height > 36000000 || !asset.source ||
        !text(asset.source.path, 1000) || !/^[a-f0-9]{64}$/.test(asset.source.sha256 ?? '') ||
        !Number.isInteger(asset.source.page) || asset.source.page < 1 ||
        !Array.isArray(asset.source.bbox) || asset.source.bbox.length !== 4 ||
        !asset.source.bbox.every(value => Number.isFinite(value) && value >= 0) ||
        asset.source.bbox[2] <= asset.source.bbox[0] || asset.source.bbox[3] <= asset.source.bbox[1]) {
      throw new Error('Invalid ACSL source asset.');
    }
    catalog.set(asset.id, asset);
  }
  const purposes = new Map();
  const references = (value, purpose) => {
    if (value === undefined) return;
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['en', 'zh'].includes(key))) {
      throw new Error('Invalid localized ACSL assets.');
    }
    for (const language of ['en', 'zh']) {
      const ids = value[language];
      if (!Array.isArray(ids) || ids.length > 20 || new Set(ids).size !== ids.length) throw new Error('Invalid localized ACSL asset IDs.');
      for (const id of ids) {
        if (!catalog.has(id) || purposes.has(id) && purposes.get(id) !== purpose) throw new Error('Unknown or mixed-purpose ACSL source asset.');
        purposes.set(id, purpose);
      }
    }
  };
  for (const question of content.questions) {
    references(question.statementAssets, 'statement');
    references(question.explanationAssets, 'explanation');
  }
  references(content.programming?.statementAssets, 'statement');
  if (catalog.size !== purposes.size) throw new Error('Unreferenced ACSL source asset.');
  const hashes = new Map();
  for (const [id, purpose] of purposes) {
    const hash = catalog.get(id).sha256;
    if (hashes.has(hash) && hashes.get(hash) !== purpose) throw new Error('The same ACSL image cannot contain both a statement and an explanation.');
    hashes.set(hash, purpose);
  }
  return purposes;
}
