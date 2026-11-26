import { fail, uuid } from './security.mjs';

async function sharedSchools(db, viewerId, accountId, platformSchoolId = null) {
  const { rows } = await db.query(
    `SELECT s.id, s.name, s.name_zh AS "nameZh", s.name_en AS "nameEn",
   owner.role FROM school_memberships owner JOIN schools s ON s.id=owner.school_id
   WHERE owner.account_id=$2 AND owner.revoked_at IS NULL AND NOT owner.suspended
    AND (s.id=$3 OR EXISTS(SELECT 1 FROM school_memberships viewer WHERE viewer.school_id=s.id
      AND viewer.account_id=$1 AND viewer.revoked_at IS NULL AND NOT viewer.suspended))
   ORDER BY owner.joined_at,s.id`,
    [viewerId, accountId, platformSchoolId],
  );
  return rows;
}

export async function defaultMessageSchool(db, viewerId, accountId) {
  return (await sharedSchools(db, viewerId, accountId))[0]?.id;
}

// Old school links may identify a dossier. Resolve it inside the original school's
// authorization boundary before combining the audiences of the underlying account.
export async function accountHomepage(ctx, id, messages, readCommunity) {
  const requested = ctx.url.searchParams.get('schoolId');
  const schoolId = requested === null ? null : uuid(requested, '学校 ID');
  const preferred = ctx.url.searchParams.get('preferredSchoolId');
  const preferredSchoolId = schoolId ?? (preferred ? uuid(preferred, '学校 ID') : null);
  const preview = schoolId && ctx.url.searchParams.get('platform') === '1';
  let accountId = id;
  if (schoolId) {
    const source = await readCommunity({
      ...ctx,
      resolveHomepageAccount: true,
      route: `${preview ? '/platform' : ''}/schools/${schoolId}/profiles/${id}`,
    });
    accountId = source.body.accountId;
  }
  const {
    rows: [target],
  } = await ctx.pool.query(
    `SELECT COALESCE(p.profile_enabled,false) shared
   FROM accounts a JOIN identities i ON i.id=a.identity_id
   LEFT JOIN public_practice_preferences p ON p.account_id=a.id
   WHERE a.id=$1 AND a.disabled_at IS NULL AND a.binding_released_at IS NULL AND i.archived_at IS NULL`,
    [accountId],
  );
  if (!target) fail(404, 'NOT_FOUND', '该主页不可访问');
  const schools = await sharedSchools(ctx.pool, ctx.user.id, accountId, preview ? schoolId : null);
  // Prefer the school that opened the page. Outside that workspace the oldest
  // shared membership gives links and new messages a stable default audience.
  schools.sort((a, b) => Number(b.id === preferredSchoolId) - Number(a.id === preferredSchoolId));
  const books = schools.map((school) => ({
    schoolId: school.id,
    name: school.name,
    nameZh: school.nameZh,
    nameEn: school.nameEn,
    role: school.role,
    base: `${preview && school.id === schoolId ? 'platform/' : ''}schools/${school.id}/profiles/${accountId}`,
  }));
  if (target.shared || ctx.user.id === accountId)
    books.push({ schoolId: null, base: 'practice/profiles/' + accountId });
  if (!books.length || (schoolId && books[0].schoolId !== schoolId)) fail(404, 'NOT_FOUND', '该主页不可访问');
  if (!messages) return { status: 200, body: { accountId, books } };

  const cursor = ctx.url.searchParams.get('before');
  const match = cursor?.match(/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z)~([\da-f-]{36})$/i);
  const timestamp = match && Date.parse(match[1]);
  if (
    cursor !== null &&
    (!match ||
      !Number.isFinite(timestamp) ||
      new Date(timestamp).toISOString().slice(0, 23) !== match[1].slice(0, 23))
  )
    fail(400, 'VALIDATION', '留言分页无效');
  const before = match ? [match[1], uuid(match[2])] : [null, null];
  const size = Number(ctx.url.searchParams.get('pageSize') ?? 5);
  if (!Number.isInteger(size) || size < 1 || size > 50) fail(400, 'VALIDATION', '留言分页无效');
  const url = new URL(ctx.url);
  url.searchParams.set('page', '1');
  url.searchParams.set('pageSize', String(size));
  const items = [];
  const accepting = {};
  let total = 0,
    replyTotal = 0;
  // Each bounded read passes through the normal membership check and PostgreSQL
  // school scope. Keep the exact timestamp for ties across schools and pages.
  for (const book of books) {
    const { body } = await readCommunity({
      ...ctx,
      url,
      homepageBefore: before,
      route: '/' + book.base + '/messages',
    });
    accepting[book.base] = body.acceptingMessages;
    total += body.total;
    replyTotal += body.replyTotal;
    for (const item of body.items) items.push({ ...item, book: book.base });
  }
  items.sort((a, b) => (a.cursor < b.cursor ? 1 : a.cursor > b.cursor ? -1 : 0));
  const page = items.slice(0, size);
  return {
    status: 200,
    body: {
      items: page,
      before: cursor,
      accepting,
      total,
      replyTotal,
      next: items.length > size ? page.at(-1).cursor : null,
    },
  };
}
