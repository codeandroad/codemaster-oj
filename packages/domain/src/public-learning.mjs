import { chapterProblemVersions, problemCatalogCourseOption } from './problem-catalog-courses.mjs';
import { handlePlatformContentEditors } from './platform-content-editors.mjs';
import { handlePlatformProblems } from './platform-problems.mjs';
import { courseEntry } from './public-course-entry.mjs';
import { localizedFields, publicChapterLocalizations } from './course-localizations.mjs';
import { projectCourseAcslLinks, acslLinkCounts, requireCourseAcslSchool } from './course-acsl.mjs';
import { transaction } from './db.mjs';
import { activeAccount, auditSchool, LEGACY_SCHOOL_ID, lockSchoolTeaching, requireSchoolAdmin } from './schools.mjs';
import { isPlatformAdministrator } from './platform-governance.mjs';
import { legacyCourseCandidate, legacyCourseIsLive, legacyCourseReviewCandidates, legacyCourseSourceVersion, legacyDirectAccess, legacyEdition, requireLegacyCourseAdmin, snapshotLegacyCourse } from './legacy-public-course.mjs';
import { publicChapterProblems } from './platform-course-progress.mjs';
import { canonicalHash, enumValue, fail, integer, uuid } from './security.mjs';
import { handlePlatformCourses } from './platform-courses.mjs';
import { platformCourseAdmission } from './platform-course-access.mjs';
import { handlePlatformCourseAdmissions } from './platform-course-admissions.mjs';
import { platformCourseListings, platformCourseEdition, platformCourseProgressEdition, platformReadProgress } from './platform-public-course.mjs';

const respond = (body, status = 200) => ({ status, body });
const setSchool = (db, id) => db.query("SELECT set_config('campus.school_id',$1,true)", [id]);
const contentHash = chapter => canonicalHash({ title: chapter.title, body: chapter.body });
const reviewPageSize = 50;

async function context(db, user, { platform = false } = {}) {
  await activeAccount(db, user.id);
  await db.query("SELECT set_config('campus.account_id',$1,true)", [user.id]);
  if (platform && !await isPlatformAdministrator(db, user.id)) {
    fail(403, 'PLATFORM_ADMIN_REQUIRED', '需要平台管理员权限');
  }
}

async function edition(db, listing, { detail = false, lock = false, progress = false, contentHashChapterIds = [] } = {}) {
  await setSchool(db, listing.school_id);
  if(listing.platform_owned&&progress)return platformCourseProgressEdition(db,listing,{contentHashChapterIds});
  if(listing.platform_owned)return platformCourseEdition(db,listing,{detail,lock});
  if (listing.school_id === LEGACY_SCHOOL_ID) return legacyEdition(db, listing, { detail, lock });
  return (await db.query(`SELECT p.title, p.description, p.revision, p.access_scope, p.properties->'localizations' AS localizations,p.properties->'sections' AS sections,
      p.required_language,p.language_credit_cutoffs,s.name school_name,
      p.properties->>'category' category, p.properties->>'difficulty' difficulty, p.properties->>'coverKey' cover_key,
      p.properties->>'coverImage' cover_image, p.properties->>'authorName' author_name,
      COALESCE(p.properties->>'authoredAt',c.created_at::text) authored_at,
      jsonb_array_length(p.chapters) chapter_count ${detail ? ', p.chapters' : ''}
    FROM school_courses c
    JOIN school_course_publications p ON p.school_id=c.school_id AND p.course_id=c.id
    JOIN schools s ON s.id=c.school_id
    WHERE c.school_id=$1 AND c.id=$2 AND p.revision=$3
      AND c.published AND c.archived_at IS NULL AND c.published_revision=p.revision
      AND ($4='application' OR p.access_scope='school')`,
  [listing.school_id, listing.course_id, listing.revision, listing.access_mode])).rows[0];
}

async function activeListing(db, id, { includeWithdrawn = false } = {}) {
  const [platform]=await platformCourseListings(db,id);
  if(platform)return platform;
  return (await db.query(`SELECT * FROM public_course_listings WHERE id=$1
    AND ($2 OR withdrawn_at IS NULL)`, [id, includeWithdrawn])).rows[0];
}

async function admissionFor(db, listing, course, accountId, options) {
  if(listing.platform_owned){const access=await platformCourseAdmission(db,listing.course_id,accountId,options);course.admissionRules=access.admissionRules;return access.admission;}
  if (listing.access_mode === 'direct') return 'direct';
  const eligible = listing.school_id === LEGACY_SCHOOL_ID
    ? await legacyDirectAccess(db, listing, course.access_scope, accountId)
    : (await db.query(`SELECT 1 FROM school_memberships m
    WHERE m.school_id=$1 AND m.account_id=$2 AND m.revoked_at IS NULL
      AND ($3='school' OR EXISTS (
        SELECT 1 FROM school_course_publication_classes pc
        JOIN school_classes c ON c.school_id=pc.school_id AND c.id=pc.class_id AND c.archived_at IS NULL
        JOIN school_class_roster r ON r.school_id=c.school_id AND r.class_id=c.id
        JOIN school_identities i ON i.school_id=r.school_id AND i.id=r.identity_id
        WHERE pc.school_id=m.school_id AND pc.course_id=$4 AND pc.revision=$5
          AND m.role='student' AND i.kind='student' AND i.archived_at IS NULL AND i.account_id=m.account_id
      ))`, [listing.school_id, accountId, course.access_scope, listing.course_id, listing.revision])).rowCount > 0;
  if (eligible) return 'direct';
  const { rows: [application] } = await db.query(`SELECT status FROM public_course_applications
    WHERE listing_id=$1 AND school_id=$2 AND access_generation=$3 AND revision=$4 AND account_id=$5`,
  [listing.id, listing.school_id, listing.access_generation, listing.revision, accountId]);
  if (application?.status === 'approved') return 'direct';
  if (application?.status === 'pending') return 'pending';
  return application ? 'rejected' : 'apply';
}


// Use the same edition and admission checks as the course reader. The filter
// returns only links that also exist in the published problem catalogue.
export async function publicProblemCatalogCourses(db, user, courseId) {
  await context(db, user);
  const { rows: schoolListings } = await db.query(`SELECT l.* FROM public_course_listings l
    WHERE l.withdrawn_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM learning_paths p WHERE p.id=l.course_id AND p.owner_scope='platform')`);
  const listings = [...await platformCourseListings(db), ...schoolListings];
  const courses = [];
  let versions = new Map();
  for (const listing of listings) {
    const course = await edition(db, listing, { detail: true });
    if (!course || await admissionFor(db, listing, course, user.id) !== 'direct') continue;
    const available = await publicChapterProblems(db,listing,course,user.id);
    const links = chapterProblemVersions([{problems:[...available.values()]}]);
    if (!links.size) continue;
    courses.push(problemCatalogCourseOption(listing.id, course));
    if (courseId === listing.id) versions = links;
  }
  return { courses, versions };
}

async function catalogue(pool, user, url) {
  return transaction(pool, async db => {
    await context(db, user);
    const acslSchoolId=url?.searchParams.has('schoolId')
      ?await requireCourseAcslSchool(db,uuid(url.searchParams.get('schoolId'),'学校 ID'),user):LEGACY_SCHOOL_ID;
    const { rows } = await db.query(`SELECT l.* FROM public_course_listings l WHERE withdrawn_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM learning_paths p WHERE p.id=l.course_id AND p.owner_scope='platform') ORDER BY approved_at DESC,id`);
    rows.unshift(...await platformCourseListings(db));
    const { rows: progress } = await db.query(`SELECT listing_id,chapter_id,content_hash FROM public_course_progress
      WHERE listing_id=ANY($1::uuid[]) AND account_id=$2 AND read`, [rows.map(row => row.id), user.id]);
    const readByListing = new Map();
    for (const row of progress) {
      if (!readByListing.has(row.listing_id)) readByListing.set(row.listing_id, new Map());
      readByListing.get(row.listing_id).set(row.chapter_id, row.content_hash);
    }
    const courses = [], admissionState = {};
    for (const listing of rows) {
      const course = await edition(db, listing);
      if (!course) continue;
      const admission = await admissionFor(db, listing, course, user.id, {state:admissionState});
      if(admission==='denied')continue;
      const entry = courseEntry(listing, course, admission);
      if (admission === 'direct') {
        const read = readByListing.get(listing.id);
        const platformRead=listing.platform_owned?await platformReadProgress(db,listing,user.id):[];
        const platformReadByChapter=new Map(platformRead.map(row=>[row.chapter_id,row.read]));
        const contentHashChapterIds=listing.platform_owned?[...(read?.keys()??[])].filter(id=>!platformReadByChapter.has(id)):[];
        const detail = await edition(db, listing, { detail: !listing.platform_owned, progress: listing.platform_owned, contentHashChapterIds });
        if (!detail) continue;
        entry.completedChapters = detail.chapters.filter(chapter => platformReadByChapter.get(chapter.id) ?? (read?.has(chapter.id) && read.get(chapter.id) === contentHash(chapter))).length;
        const available = await publicChapterProblems(db, listing, detail, user.id);
        const exercises = detail.chapters.flatMap(chapter => chapter.problems ?? [])
          .flatMap(link => available.get(`${link.problemId}:${link.versionId}`) ?? []);
        entry.totalExercises = exercises.length;
        entry.completedExercises = exercises.filter(problem => problem.solved).length;
        const acslLinks=await projectCourseAcslLinks(db,listing.platform_owned?acslSchoolId:listing.school_id,user,detail.chapters.flatMap(chapter=>chapter.acslLinks??[]));
        const counts=acslLinkCounts(acslLinks);entry.totalExercises+=counts.total;entry.completedExercises+=counts.completed;
      }
      courses.push(entry);
    }
    return courses;
  });
}


export async function publicCourseProblemLanguage(db, user, { courseId, chapterId, schoolId, problemId, versionId }) {
  await context(db, user);
  const listing = await activeListing(db, courseId);
  const course = listing?.school_id === schoolId && await edition(db, listing, { detail: true, lock: true });
  if (!course) fail(404, 'COURSE_PROBLEM_UNAVAILABLE', '公开课程不存在或已撤回');
  if (await admissionFor(db, listing, course, user.id) !== 'direct') {
    fail(403, 'COURSE_APPLICATION_REQUIRED', '请先申请加入课程');
  }
  const chapter = course.chapters.find(item => item.id === chapterId);
  const available=await publicChapterProblems(db,listing,course,user.id);
  if (!chapter?.problems?.some(link => {const current=available.get(`${link.problemId}:${link.versionId}`);return current?.problemId===problemId&&current.versionId===versionId;})) {
    fail(404, 'COURSE_PROBLEM_UNAVAILABLE', '此题不在可访问的公开课程章节中');
  }
  return course.required_language;
}

async function publicCourse({ pool, user, method, body, url }, match) {
  const id = uuid(match[1], '课程目录 ID');
  return transaction(pool, async db => {
    const source = await activeListing(db, id);
    if (!source) fail(404, 'NOT_FOUND', '公开课程不存在或已撤回');
    await lockSchoolTeaching(db, source.school_id, { shared: true });
    await context(db, user);
    const listing = await activeListing(db, id);
    const course = listing && await edition(db, listing, { lock: true });
    if (!course) fail(404, 'NOT_FOUND', '公开课程不存在或已撤回');

    let acslSchoolId=listing.platform_owned?LEGACY_SCHOOL_ID:listing.school_id;
    if(url?.searchParams.has('schoolId')){
      acslSchoolId=await requireCourseAcslSchool(db,uuid(url.searchParams.get('schoolId'),'学校 ID'),user);
      if(!listing.platform_owned&&acslSchoolId!==listing.school_id)
        fail(400,'INVALID_COURSE_SCHOOL_CONTEXT','校内公开课程不能切换练习来源学校');
    }

    const admission = await admissionFor(db, listing, course, user.id);
    if(admission==='denied')fail(404,'NOT_FOUND','课程不存在或不在开放范围');
    if (match[2] === 'entry' && method === 'GET') return respond(courseEntry(listing, course, admission));
    if (match[2] === 'applications' && method === 'POST') {
      if (body.expectedRevision !== course.revision) fail(409, 'REVISION_CONFLICT', '课程版本已更新，请刷新');
      if (admission === 'apply') {
        await db.query(`INSERT INTO public_course_applications(listing_id,school_id,revision,access_generation,account_id)
          VALUES($1,$2,$3,$4,$5) ON CONFLICT(listing_id,access_generation,account_id) DO NOTHING`,
        [listing.id, listing.school_id, listing.revision, listing.access_generation, user.id]);
        return respond(courseEntry(listing, course, 'pending'), 201);
      }
      return respond(courseEntry(listing, course, admission));
    }
    if (match[2] && !match[3]) return null;
    if (admission !== 'direct') fail(403, 'COURSE_APPLICATION_REQUIRED', '请先申请加入课程');
    const detail = await edition(db, listing, { detail: true });
    const publishedChapters = detail.chapters;
    if (method === 'POST') {
      if (!match[3]) return null;
      if (body.expectedRevision !== course.revision) fail(409, 'REVISION_CONFLICT', '课程版本已更新，请刷新');
      if (typeof body.read !== 'boolean') fail(400, 'VALIDATION', '阅读状态无效');
      const chapterId = uuid(match[3], '章节 ID');
      const chapter = publishedChapters.find(c => c.id === chapterId);
      if (!chapter) fail(404, 'NOT_FOUND', '章节不存在');
      if(listing.platform_owned)await db.query(`INSERT INTO learning_progress(identity_id,chapter_id,completed)
        VALUES($1,$2,$3) ON CONFLICT(identity_id,chapter_id) DO UPDATE SET completed=EXCLUDED.completed,updated_at=now()`,[user.identityId,chapter.id,body.read]);
      else await db.query(`INSERT INTO public_course_progress(listing_id,account_id,chapter_id,content_hash,read)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT(listing_id,account_id,chapter_id) DO UPDATE SET
        content_hash=EXCLUDED.content_hash,read=EXCLUDED.read,updated_at=now()`,
      [listing.id, user.id, chapter.id, contentHash(chapter), body.read]);
    }
    const { rows: progress } = await db.query(
      'SELECT chapter_id,content_hash,read FROM public_course_progress WHERE listing_id=$1 AND account_id=$2',
      [listing.id, user.id]);
    const platformRead=listing.platform_owned?await platformReadProgress(db,listing,user.id):[];
    const availableProblems = await publicChapterProblems(db, listing, detail, user.id);
    const acslByChapter=new Map();
    for(const chapter of publishedChapters)acslByChapter.set(chapter.id,await projectCourseAcslLinks(db,acslSchoolId,user,chapter.acslLinks??[]));
    const chapters = publishedChapters.map((c, position) => ({
      sectionKey:c.sectionKey??null,...localizedFields(listing.platform_owned?c.localizations:publicChapterLocalizations(c.localizations)),id: c.id, title: c.title, body: c.body, position,
      ...(listing.platform_owned?{objective:c.objective??'',checkpoint:c.checkpoint??'',checkpointAnswer:c.checkpointAnswer??''}:{}),
      ...(c.acslLinks?.length?{acslLinks:acslByChapter.get(c.id)}:{}),
      read: platformRead.find(p=>p.chapter_id===c.id)?.read??progress.some(p => p.chapter_id === c.id && p.content_hash === contentHash(c) && p.read),
      problems: (c.problems ?? []).flatMap(({ problemId, versionId }) => {
        const problem = availableProblems.get(`${problemId}:${versionId}`);
        return problem ? [problem] : [];
      }),
    }));
    return respond({
      ...courseEntry(listing, course, admission),
      chapters, completedChapters: chapters.filter(c => c.read).length, canTrackProgress: true,
      totalExercises: chapters.reduce((total, chapter) => total + chapter.problems.length + acslLinkCounts(chapter.acslLinks??[]).total, 0),
      completedExercises: chapters.reduce((total, chapter) => total + chapter.problems.filter(problem => problem.solved).length + acslLinkCounts(chapter.acslLinks??[]).completed, 0),
    });
  });
}

async function publishListing(db, schoolId, courseId, revision, actorId, mode) {
  const { rows: [listing] } = await db.query(`INSERT INTO public_course_listings(school_id,course_id,revision,approved_by,access_mode)
    VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(school_id,course_id) DO UPDATE SET
      revision=EXCLUDED.revision, approved_by=EXCLUDED.approved_by, approved_at=now(), withdrawn_at=NULL,
      access_generation=CASE WHEN public_course_listings.revision<>EXCLUDED.revision
        OR public_course_listings.access_mode<>EXCLUDED.access_mode OR public_course_listings.withdrawn_at IS NOT NULL
        THEN gen_random_uuid() ELSE public_course_listings.access_generation END,
      access_mode=EXCLUDED.access_mode
    RETURNING *`, [schoolId, courseId, revision, actorId, mode]);
  return listing;
}

// The admission queue and notification inbox only link to a live application edition.
export const currentCourseAdmissionsJoin = `JOIN LATERAL (
    SELECT v.title FROM legacy_course_publication_versions v
    JOIN learning_paths p ON p.school_id=v.school_id AND p.id=v.course_id
    WHERE v.school_id=l.school_id AND v.course_id=l.course_id AND v.revision=l.legacy_revision
      AND p.owner_scope='school' AND (${legacyCourseIsLive}) AND v.source_version=${legacyCourseSourceVersion}
    UNION ALL
    SELECT p.title FROM school_courses c
    JOIN school_course_publications p ON p.school_id=c.school_id AND p.course_id=c.id AND p.revision=c.published_revision
    WHERE c.school_id=l.school_id AND c.id=l.course_id AND p.revision=l.school_revision
      AND c.published AND c.archived_at IS NULL
  ) course ON l.access_mode='application' AND l.withdrawn_at IS NULL`;

async function requireCourseAdmissionsAdmin(db, schoolId, accountId, shared) {
  await lockSchoolTeaching(db, schoolId, { shared });
  if (schoolId === LEGACY_SCHOOL_ID) await requireLegacyCourseAdmin(db, accountId);
  else await requireSchoolAdmin(db, schoolId, accountId);
  await setSchool(db, schoolId);
  await db.query("SELECT set_config('campus.course_admission_school_id',$1,true)", [schoolId]);
}

async function schoolAdmissionsList({ pool, user, url }, schoolId) {
  const page = integer(Number(url.searchParams.get('page') ?? '1'), 1, 100000, '页码');
  return transaction(pool, async db => {
    await requireCourseAdmissionsAdmin(db, schoolId, user.id, true);
    const { rows } = await db.query(`SELECT l.course_id id, course.title, pending.count "pendingCount"
      FROM public_course_listings l
      ${currentCourseAdmissionsJoin}
      CROSS JOIN LATERAL (
        SELECT count(*)::int count FROM public_course_applications ca
        WHERE ca.school_id=l.school_id AND ca.listing_id=l.id AND ca.access_generation=l.access_generation
          AND ca.revision=l.revision AND ca.status='pending'
      ) pending
      WHERE l.school_id=$1
      ORDER BY (pending.count > 0) DESC, course.title, l.course_id LIMIT $2 OFFSET $3`,
    [schoolId, reviewPageSize + 1, (page - 1) * reviewPageSize]);
    return respond({ items: rows.slice(0, reviewPageSize), page, hasMore: rows.length > reviewPageSize });
  });
}

async function schoolAdmissions({ pool, user, method, body, url }, match) {
  const schoolId = uuid(match[1], '学校 ID');
  const courseId = uuid(match[2], '课程 ID');
  return transaction(pool, async db => {
    await requireCourseAdmissionsAdmin(db, schoolId, user.id, method === 'GET');
    const legacy = schoolId === LEGACY_SCHOOL_ID;
    const course = legacy
      ? await legacyCourseCandidate(db, courseId, { lock: true })
      : (await db.query(`SELECT c.published_revision,c.archived_at,c.published,COALESCE(p.title,c.title) title,p.access_scope
      FROM school_courses c LEFT JOIN school_course_publications p
        ON p.school_id=c.school_id AND p.course_id=c.id AND p.revision=c.published_revision
      WHERE c.school_id=$1 AND c.id=$2`, [schoolId, courseId])).rows[0];
    if (!course) fail(404, 'NOT_FOUND', '课程不存在或不可访问');

    const { rows: [listing] } = await db.query(
      'SELECT * FROM public_course_listings WHERE school_id=$1 AND course_id=$2', [schoolId, courseId]);
    const live = course.published && !course.archived_at;
    const current = live && listing && !listing.withdrawn_at && listing.revision === course.published_revision;
    if (method === 'GET' && !match[3]) {
      const page = integer(Number(url.searchParams.get('page') ?? '1'), 1, 100000, '页码');
      const applicationId = url.searchParams.get('applicationId');
      if (applicationId !== null) uuid(applicationId, '申请 ID');
      const { rows } = current && listing.access_mode === 'application'
        ? await db.query(`SELECT ca.id, ca.status, ca.created_at AS "createdAt", i.name,
            a.username
          FROM public_course_applications ca JOIN accounts a ON a.id=ca.account_id
          JOIN identities i ON i.id=a.identity_id
          WHERE ca.school_id=$1 AND ca.listing_id=$2 AND ca.access_generation=$3 AND ca.revision=$4
          ORDER BY (ca.id=$5) DESC NULLS LAST, (ca.status='pending') DESC, ca.created_at, ca.id LIMIT $6 OFFSET $7`,
        [schoolId, listing.id, listing.access_generation, listing.revision, applicationId, reviewPageSize + 1, (page - 1) * reviewPageSize])
        : { rows: [] };
      return respond({
        courseTitle: course.title,
        revision: live ? course.published_revision : null,
        ...(legacy && { sourceVersion: course.source_version }),
        accessScope: course.access_scope ?? null,
        mode: current ? listing.access_mode : null,
        applications: rows.slice(0, reviewPageSize),
        page,
        hasMore: rows.length > reviewPageSize,
      });
    }
    if (!live || body.expectedRevision !== course.published_revision
      || (legacy && body.sourceVersion !== course.source_version)) {
      fail(409, 'REVISION_CONFLICT', '课程版本已更新，请刷新');
    }
    if (method === 'POST' && !match[3]) {
      if (current && listing.access_mode === 'direct') fail(409, 'ALREADY_PUBLIC', '此课程已由平台公开');
      if (legacy) await snapshotLegacyCourse(db, course);
      const published = await publishListing(db, schoolId, courseId, course.published_revision, user.id, 'application');
      if (!current) await auditSchool(db, schoolId, user.id, 'school.course.admissions.open', courseId);
      return respond({ id: published.id, mode: 'application' }, 201);
    }
    if (!current || listing.access_mode !== 'application') fail(409, 'COURSE_ADMISSIONS_CLOSED', '当前版本未开放课程申请');
    if (method === 'DELETE' && !match[3]) {
      await db.query('UPDATE public_course_listings SET withdrawn_at=now() WHERE id=$1', [listing.id]);
      await auditSchool(db, schoolId, user.id, 'school.course.admissions.close', courseId);
      return respond({ mode: null });
    }
    if (method === 'POST' && match[3]) {
      const action = enumValue(body.action, ['approve', 'reject', 'revoke'], '处理结果');
      const status = { approve: 'approved', reject: 'rejected', revoke: 'revoked' }[action];
      const from = action === 'revoke' ? 'approved' : 'pending';
      const applicationId = uuid(match[3], '申请 ID');
      const { rowCount } = await db.query(`UPDATE public_course_applications
        SET status=$6,decided_by=$7,decided_at=now()
        WHERE school_id=$1 AND listing_id=$2 AND access_generation=$3 AND revision=$4 AND id=$5 AND status=$8`,
      [schoolId, listing.id, listing.access_generation, listing.revision, applicationId, status, user.id, from]);
      if (!rowCount) fail(409, 'COURSE_APPLICATION_CHANGED', '申请已处理或不可用，请刷新');
      if (action !== 'revoke') {
        await db.query(`INSERT INTO course_admission_notifications
          (application_id,recipient_account_id,listing_id,outcome,course_title,created_at)
          SELECT id,account_id,listing_id,status,$2,decided_at FROM public_course_applications WHERE id=$1`,
        [applicationId, course.title]);
      }
      await auditSchool(db, schoolId, user.id, 'school.course.admissions.' + action, applicationId);
      return respond({ status });
    }
    return null;
  });
}

async function platformPublications({ pool, user, method, body }) {
  return transaction(pool, async db => {
    if (method === 'GET') {
      await context(db, user, { platform: true });
      const { rows: schools } = await db.query('SELECT id,name FROM schools ORDER BY name,id');
      const items = [];
      for (const school of schools) {
        await setSchool(db, school.id);
        const rows = school.id === LEGACY_SCHOOL_ID
          ? await legacyCourseReviewCandidates(db)
          : (await db.query(`SELECT c.id,c.published_revision,p.title,p.description,p.required_language,p.properties->'sections' AS sections,
            CASE WHEN p.access_scope='school' THEN p.chapters ELSE '[]'::jsonb END chapters,
            p.access_scope, jsonb_array_length(p.chapters) chapter_count,
            l.id listing_id,l.revision approved_revision,l.withdrawn_at,l.access_mode
          FROM school_courses c
          JOIN school_course_publications p ON p.school_id=c.school_id AND p.course_id=c.id AND p.revision=c.published_revision
          LEFT JOIN public_course_listings l ON l.school_id=c.school_id AND l.course_id=c.id
          WHERE c.school_id=$1 AND c.published AND c.archived_at IS NULL
            AND (p.access_scope='school' OR (
              l.access_mode='application' AND l.withdrawn_at IS NULL AND l.revision=p.revision
            ))
          ORDER BY p.title,c.id`,
        [school.id])).rows;
        for (const c of rows) {
          const listingActive = !!c.listing_id && !c.withdrawn_at && c.approved_revision === c.published_revision;
          items.push({
            schoolId: school.id, schoolName: school.name, courseId: c.id, revision: c.published_revision,
            ...(c.source_version && { sourceVersion: c.source_version }),
            title: c.title, description: c.description, requiredLanguage: c.required_language ?? null,
            sections:c.sections??[],chapters: c.chapters.map(ch => ({ id: ch.id, title: ch.title, body: ch.body,sectionKey:ch.sectionKey??null })),
            chapterCount: c.chapter_count, canPublishDirect: c.access_scope === 'school',
            listingId: c.listing_id ?? null, listingActive, approvedRevision: c.approved_revision ?? null,
            admissionMode: listingActive ? c.access_mode : null,
            published: listingActive && c.access_mode === 'direct',
          });
        }
      }
      return respond({ items });
    }
    const schoolId = uuid(body.schoolId);
    const courseId = uuid(body.courseId);
    const revision = integer(body.revision, 1, 2147483647, '版本');
    await lockSchoolTeaching(db, schoolId);
    await context(db, user, { platform: true });
    if (schoolId === LEGACY_SCHOOL_ID) {
      await setSchool(db, schoolId);
      const source = await legacyCourseCandidate(db, courseId, { lock: true });
      if (!source?.published || source.access_scope !== 'school') {
        fail(409, 'NOT_PUBLISHED', '请先在学校发布这个版本的全校课程');
      }
      if (source.published_revision !== revision || source.source_version !== body.sourceVersion) {
        fail(409, 'REVISION_CONFLICT', '课程版本已更新，请刷新');
      }
      await snapshotLegacyCourse(db, source);
    } else {
      const source = await edition(db, { school_id: schoolId, course_id: courseId, revision, access_mode: 'direct' });
      if (!source) fail(409, 'NOT_PUBLISHED', '请先在学校发布这个版本的全校课程');
    }
    const listing = await publishListing(db, schoolId, courseId, revision, user.id, 'direct');
    await db.query("INSERT INTO platform_audit_events(actor_account_id,action,school_id,detail) VALUES($1,'public.course.approved',$2,$3)",
      [user.id, schoolId, { courseId, revision, listingId: listing.id }]);
    return respond({ id: listing.id, published: true }, 201);
  });
}

export async function handlePublicLearning(ctx) {
  for(const handler of [handlePlatformContentEditors,handlePlatformProblems]){const result=await handler(ctx);if(result)return result;}
  const admissions=await handlePlatformCourseAdmissions(ctx);if(admissions)return admissions;
  const { pool, user, route, method, url } = ctx;
  if(/^\/platform\/courses(?:\/|$)/.test(route))return handlePlatformCourses(ctx);
  if (route === '/practice/courses' && method === 'GET') return respond({courses:await catalogue(pool,user,url)});
  if (route === '/practice/catalog' && method === 'GET') {
    const { listPublicProblems } = await import('./school-practice.mjs');
    const courses = await catalogue(pool, user, url);
    const { items: problems } = await listPublicProblems(pool, user, url);
    return respond({ courses, problems });
  }
  const publicMatch = route.match(/^\/practice\/courses\/([^/]+)(?:\/(entry|applications|chapters\/([^/]+)\/read))?$/);
  if (publicMatch && (method === 'GET' || method === 'POST')) return publicCourse(ctx, publicMatch);

  const admissionsList = route.match(/^\/schools\/([^/]+)\/course-admissions$/);
  if (admissionsList && method === 'GET') return schoolAdmissionsList(ctx, uuid(admissionsList[1], '学校 ID'));
  const schoolMatch = route.match(/^\/schools\/([^/]+)\/course-admissions\/([^/]+)(?:\/([^/]+)\/decision)?$/);
  if (schoolMatch) return schoolAdmissions(ctx, schoolMatch);

  if (route === '/platform/course-publications' && (method === 'GET' || method === 'POST')) {
    return platformPublications(ctx);
  }
  const withdrawal = route.match(/^\/platform\/course-publications\/([^/]+)$/);
  if (withdrawal && method === 'DELETE') {
    return transaction(pool, async db => {
      const id = uuid(withdrawal[1]);
      const source = await activeListing(db, id, { includeWithdrawn: true });
      if (source) await lockSchoolTeaching(db, source.school_id);
      await context(db, user, { platform: true });
      if (!source) fail(404, 'NOT_FOUND', '公开记录不存在');
      if(source.platform_owned)fail(409,'PLATFORM_COURSE_MANAGEMENT','请在平台课程管理中下架课程');
      await db.query('UPDATE public_course_listings SET withdrawn_at=COALESCE(withdrawn_at,now()) WHERE id=$1', [id]);
      await db.query("INSERT INTO platform_audit_events(actor_account_id,action,school_id,detail) VALUES($1,'public.course.withdrawn',$2,$3)",
        [user.id, source.school_id, { courseId: source.course_id }]);
      return respond({ published: false });
    });
  }
  return null;
}
