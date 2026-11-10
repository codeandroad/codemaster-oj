import { createPool, transaction } from '../packages/domain/src/db.mjs';

const bankId = '00000000-0000-4000-8000-000000000001';
const courseTitle = 'Python 专项训练 · 全目录学习路线';
const chapterTitle = '02. 列表、元组与嵌套数据 · Basic Data Types';
const supplementSource = 'Independent CodeMaster exercise; Python list supplement for chapter 02.';
const titles = [
  'Python 02-06 · Immutable coordinate key',
  'Python 02-07 · Ribbon slice patch',
  'Python 02-08 · Batch pickup audit',
  'Python 02-09 · Flattened checkpoint index',
  'Python 02-10 · Independent timetable branches',
  'Python 02-11 · Stable dispatch board',
  'Python 02-12 · Batch clearance snapshots',
  'Python 02-13 · First eligible pickup',
  'Python 02-14 · Compressed readings summary',
];

function check(condition, message) {
  if (!condition) throw new Error(message);
}

async function repair(db, apply) {
  // Read group members after acquiring the same row lock used by group edits.
  await db.query(apply
    ? 'SET TRANSACTION ISOLATION LEVEL READ COMMITTED'
    : 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');

  const { rows: groups } = await db.query(`SELECT g.id, b.school_id FROM problem_groups g
    JOIN problem_banks b ON b.id = g.bank_id
    WHERE g.bank_id = $1 AND g.name = $2 AND g.archived_at IS NULL
      AND b.is_system AND b.visibility = 'school' AND b.archived_at IS NULL
    ${apply ? 'FOR UPDATE OF g' : ''}`, [bankId, courseTitle]);
  const { rows: courses } = await db.query(`SELECT id, school_id FROM learning_paths
    WHERE title = $1 AND published_at IS NOT NULL AND archived_at IS NULL
    ${apply ? 'FOR SHARE' : ''}`, [courseTitle]);
  if (!groups.length && !courses.length) return { action: 'not-applicable' };
  check(groups.length === 1 && courses.length === 1 && groups[0].school_id === courses[0].school_id,
    'Expected one active group and published course in the same school.');
  const [{ id: groupId }] = groups;
  const { rows: chapters } = await db.query(`SELECT id FROM learning_chapters
    WHERE path_id = $1 AND title = $2 AND archived_at IS NULL
    ${apply ? 'FOR SHARE' : ''}`, [courses[0].id, chapterTitle]);
  check(chapters.length === 1, 'Expected one active Chapter 2 in the published course.');
  const { rows: pins } = await db.query(`SELECT p.id AS problem_id, v.title, v.source
    FROM chapter_problems cp
    JOIN problems p ON p.id = cp.problem_id
    JOIN problem_versions v ON v.id = cp.version_id AND v.problem_id = p.id AND v.id = p.current_version_id
    WHERE cp.chapter_id = $1 AND p.bank_id = $2 AND p.archived_at IS NULL AND v.title = ANY($3::text[])
      AND v.published_at IS NOT NULL AND v.school_visible_at IS NOT NULL
      AND v.rank_review_status = 'approved' AND v.validation_status = 'AC'
    ORDER BY cp.position, p.id ${apply ? 'FOR SHARE OF p, v' : ''}`, [chapters[0].id, bankId, titles]);
  check(pins.length === titles.length && pins.every((pin, index) => pin.title === titles[index])
    && pins.slice(1).every(pin => pin.source === supplementSource),
    'The expected Chapter 2 pins are missing, reordered, or not published and approved.');

  // Read the complete group, including archived problems omitted by the group API.
  const { rows: members } = await db.query(`SELECT problem_id, position FROM problem_group_members
    WHERE group_id = $1 ORDER BY position, problem_id`, [groupId]);
  const ordered = [...members];
  let predecessor = ordered.findIndex(member => member.problem_id === pins[0].problem_id);
  check(predecessor !== -1, 'The group does not contain the expected 02-06 anchor.');
  const present = new Set(members.map(member => member.problem_id));
  const missing = pins.slice(1).filter(pin => !present.has(pin.problem_id));
  if (!missing.length) return { action: 'already-repaired', groupId, members: members.length };
  check(members.length + missing.length <= 500, 'The repaired group would exceed the 500-problem limit.');

  // Insert after each exercise's preceding pin without changing the relative order of existing members.
  for (const pin of pins.slice(1)) {
    const index = ordered.findIndex(member => member.problem_id === pin.problem_id);
    if (index === -1) {
      ordered.splice(++predecessor, 0, pin);
    } else {
      check(index > predecessor, 'Existing Chapter 2 members are out of order. Review the group manually.');
      predecessor = index;
    }
  }

  if (apply) {
    // Retain positions whenever they can accommodate the inserted members.
    let nextPosition = members[0].position;
    const positions = ordered.map(member => {
      const position = Math.max(nextPosition, member.position ?? nextPosition);
      nextPosition = position + 1;
      return position;
    });
    await db.query(`INSERT INTO problem_group_members (group_id, problem_id, position)
      SELECT $1, problem_id, position FROM unnest($2::uuid[], $3::int[]) AS members(problem_id, position)
      ON CONFLICT (group_id, problem_id) DO UPDATE SET position = EXCLUDED.position
      WHERE problem_group_members.position IS DISTINCT FROM EXCLUDED.position`,
    [groupId, ordered.map(member => member.problem_id), positions]);
  }

  return { action: apply ? 'repaired' : 'would-repair', groupId, members: ordered.length,
    addedProblems: missing.map(pin => pin.title) };
}

const usage = 'Usage: node scripts/repair-python-chapter2-group.mjs [--apply]\n'
  + 'Set DATABASE_URL to the target database. Without --apply, the repair is read-only.';

async function main(args) {
  if (args.length === 1 && args[0] === '--help') {
    console.log(usage);
    return;
  }
  check(!args.length || (args.length === 1 && args[0] === '--apply'), usage);
  check(process.env.DATABASE_URL, 'DATABASE_URL is required. Select the target database explicitly.');
  const pool = createPool();
  try {
    console.log(JSON.stringify(await transaction(pool, db => repair(db, args[0] === '--apply'))));
  } finally {
    await pool.end();
  }
}

main(process.argv.slice(2)).catch(error => {
  // Connection and driver errors may contain deployment details.
  console.error(error.code ? `Chapter 2 group repair failed (${error.code}).` : error.message);
  process.exitCode = 1;
});
