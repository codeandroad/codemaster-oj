// Reward settlement lives in transaction-bound database triggers. These
// helpers expose only the frozen rules and audit metadata, never balances as
// mutable application state. Existing grade/point calculations stay separate.
export const luqRewardRuleShape = row => row ? ({ id: row.id, activityType: row.activity_type,
 activityId: row.activity_id, ruleVersion: row.rule_version, amount: row.amount,
 minimumAc: row.minimum_ac, minimumScore: Number(row.minimum_score), taskKind: row.task_kind,
 allowSolutionAssisted: row.allow_solution_assisted, createdAt: row.created_at }) : null;
export async function latestLuqRewardRule(db, activityType, activityId) {
 return luqRewardRuleShape((await db.query(`SELECT * FROM luq_activity_rules WHERE activity_type=$1 AND activity_id=$2
  ORDER BY rule_version DESC LIMIT 1`, [activityType, activityId])).rows[0]);
}
