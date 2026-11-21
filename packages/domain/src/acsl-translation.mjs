import { canonicalHash, fail, uuid } from './security.mjs';
import { lockScholarshipAssistance } from './scholarship-access.mjs';
import { postSchoolScholarshipEntry, schoolScholarshipRequest, schoolScholarshipSettings, schoolScholarshipWallet } from './school-scholarship.mjs';
import { readAcslSolutionPrice } from './acsl-pricing.mjs';

async function wallet(db, schoolId, user, lock) {
  const account = await schoolScholarshipWallet(db, schoolId, user, { lock });
  const settings = await schoolScholarshipSettings(db, schoolId);
  return { ...account, translationPrice: settings.translationPrice };
}

async function assistanceState(db, paper, user, kind, { lock = false, solved = false } = {}) {
  const subjectKey = `acsl:${paper.id}`;
  const language = kind === 'FULL_TRANSLATION' ? 'zh-CN' : '';
  if (lock) await lockScholarshipAssistance(db, user.identityId);
  const account = await wallet(db, paper.school_id, user, lock);
  const scope = [account.identityId, subjectKey, paper.school_id];
  const owned = (await db.query(`SELECT kind,language FROM school_scholarship_entitlements
    WHERE identity_id=$1 AND subject_key=$2 AND school_id=$3`, scope)).rows;
  const unlocked = owned.some(row => row.kind === kind && row.language === language);
  const programming = paper.definition.programming;
  const solution = kind === 'FULL_SOLUTION';
  const available = !solution || Boolean(programming.solution);
  const contentId = available ? canonicalHash(solution ? [paper.version_id, programming.solution] :
    [paper.version_id, programming.statementZh, programming.statementDiagrams?.zh ?? [], programming.statementAssets?.zh ?? [], paper.definition.assets ?? []]) : null;
  const basePrice = solution ? (await readAcslSolutionPrice(db, paper)).effectivePrice : account.translationPrice;
  const mode = basePrice === 0 || solution && solved ? 'free' : 'paid';
  let translationPurchase = null;
  if (solution && mode === 'paid' && !unlocked) {
    translationPurchase = (await db.query(`SELECT l.id,-l.delta paid FROM school_scholarship_entitlements e
      JOIN school_scholarship_ledger l ON l.id=e.ledger_id AND l.identity_id=e.identity_id AND l.school_id=e.school_id
      WHERE e.identity_id=$1 AND e.subject_key=$2 AND e.school_id=$3 AND e.kind='FULL_TRANSLATION' AND e.language='zh-CN' AND l.kind='purchase'
        AND NOT EXISTS(SELECT 1 FROM school_scholarship_ledger refund WHERE refund.refund_of=l.id AND refund.school_id=l.school_id)`, scope)).rows[0] ?? null;
  }
  const translationCredit = Math.min(basePrice, translationPurchase?.paid ?? 0);
  const price = unlocked || mode === 'free' ? 0 : basePrice - translationCredit;
  return { subjectKey, kind, language, account, creditLedgerId: translationCredit > 0 ? translationPurchase.id : null,
    quote: { available, mode, unlocked, price, basePrice, translationCredit, contentId,
      balance: account.balance, balanceAfter: account.balance - price,
      requiresConfirmation: available && mode === 'paid' && !unlocked,
      affectsFirstAcScholarship: false, reason: available ? null : 'A reference implementation is not available for this problem.' } };
}

function checkAvailable(quote) {
  if (!quote.available) fail(404, 'ASSISTANCE_UNAVAILABLE', quote.reason);
}
function checkDelivery(quote) {
  checkAvailable(quote);
  if (quote.mode === 'paid' && !quote.unlocked) fail(403, 'UNLOCK_REQUIRED', 'Unlock this content first.');
}

export async function requireAcslTranslation(db, paper, user) {
  checkDelivery((await assistanceState(db, paper, user, 'FULL_TRANSLATION')).quote);
}

async function acslAssistance(db, paper, user, kind, action, input, content, solved = false) {
  const { subjectKey, language, account, creditLedgerId, quote } = await assistanceState(db, paper, user, kind, { lock: action === 'unlock', solved });
  if (action === 'quote') return quote;
  if (action === 'provide') {
    checkDelivery(quote);
    return { ...content(), kind, language, contentId: quote.contentId };
  }
  checkAvailable(quote);
  const { identityId } = account;
  const schoolId = paper.school_id;
  const requestId = uuid(input.requestKey, 'Request ID');
  const request = { subjectKey, kind, language };
  const verifyQuote = () => {
    if (input.confirmedContentId !== quote.contentId || input.confirmedPrice !== quote.price) {
      fail(409, 'QUOTE_CHANGED', 'The content or price changed. Check the price again.');
    }
    if (quote.balance < quote.price) fail(409, 'INSUFFICIENT_BALANCE', 'Insufficient scholarship balance.');
  };
  const metadata = { ...request, contentId: quote.contentId, versionId: paper.programming_version_id,
    basePrice: quote.basePrice, translationCredit: quote.translationCredit, translationCreditLedgerId: creditLedgerId };
  const reason = kind === 'FULL_TRANSLATION' ? '解锁 ACSL 中文题面' : '解锁 ACSL 参考实现与解析';
    return schoolScholarshipRequest(db, schoolId, user, requestId, request, async requestHash => {
      if (quote.unlocked || quote.mode === 'free') return { unlocked: quote.unlocked, balance: quote.balance, charged: 0 };
      verifyQuote();
      const entry = quote.price > 0 ? await postSchoolScholarshipEntry(db, { schoolId, identityId, delta: -quote.price,
        kind: 'purchase', sourceKey: `purchase:${identityId}:${subjectKey}:${kind}:${language}`,
        actor: user.id, reason, metadata, requestHash }) : null;
      await db.query(`INSERT INTO school_scholarship_entitlements(school_id,identity_id,subject_key,kind,language,ledger_id,credit_ledger_id)
        VALUES($1,$2,$3,$4,$5,$6,$7)`, [schoolId, identityId, subjectKey, kind, language, entry?.id ?? null, creditLedgerId]);
      return { unlocked: true, balance: entry?.balance_after ?? quote.balance, charged: quote.price };
    });

}

export function acslTranslation(db, paper, user, action, input, content) {
  return acslAssistance(db, paper, user, 'FULL_TRANSLATION', action, input, content);
}

export function acslSolution(db, paper, user, action, input, solved) {
  const language = input.contentLanguage === 'zh' ? 'zh' : 'en';
  return acslAssistance(db, paper, user, 'FULL_SOLUTION', action, input, () => {
    const solution = paper.definition.programming.solution;
    return { body: '', solution: { language: solution.language, code: solution.code,
      explanation: solution.explanation[language], complexity: solution.complexity[language] } };
  }, solved);
}
