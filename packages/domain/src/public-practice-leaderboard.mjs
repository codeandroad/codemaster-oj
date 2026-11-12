import { defaultAvatarPath } from './avatars.mjs';
import { transaction } from './db.mjs';
import { integer } from './security.mjs';
import { activeAccount } from './schools.mjs';
import { publicPracticeFirstAc, setPublicPracticeHistoryAccount } from './public-practice-records.mjs';

const PAGE_SIZE = 50;
export const POINTS_PER_SOLVED = 10;

export async function publicPracticeLeaderboard({ pool, user, url }) {
 const page = integer(Number(url.searchParams.get('page') ?? 1), 1, 100000, 'Page');
 return transaction(pool, async db => {
  await activeAccount(db, user.id);
  const { rows } = await db.query('SELECT * FROM public_practice_leaderboard($1,$2,$3)', [user.id, page, PAGE_SIZE]);
  await setPublicPracticeHistoryAccount(db, user.id);
  const { rows: [progress] } = await db.query(`SELECT count(*)::int solved,
   COALESCE((SELECT ranking_enabled FROM public_practice_preferences WHERE account_id=$1),false) AS "rankingEnabled",
   COALESCE((SELECT rank_history_included FROM public_practice_preferences WHERE account_id=$1),false) AS "historyIncluded"
   FROM (${publicPracticeFirstAc}) first_ac`, [user.id]);
  const total = rows[0]?.total ?? 0;
  function shape(row) {
   return {
    rank: row.rank, name: row.display_name, avatar: defaultAvatarPath(row.avatar_key),
    isOwn: row.is_own, points: row.solved * POINTS_PER_SOLVED, solved: row.solved,
    attempts: row.attempts, acRate: row.ac_rate === null ? null : Number(row.ac_rate),
   };
  }
  return {
   status: 200,
   body: {
    items: rows.filter(row => row.in_page).map(shape),
    own: shape(rows.find(row => row.is_own)),
    progress,
    page, pageSize: PAGE_SIZE, total, hasMore: page * PAGE_SIZE < total,
    pointsPerSolved: POINTS_PER_SOLVED,
   },
  };
 });
}
