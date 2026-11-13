export async function platformPoints(db, accountId) {
 const { rows: [balance] } = await db.query('SELECT platform_points_for_account($1) AS points', [accountId]);
 return Number(balance.points);
}
