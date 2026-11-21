export async function platformPoints(db, accountId) {
 const { rows: [balance] } = await db.query('SELECT platform_points_for_account($1) AS points', [accountId]);
 return Number(balance.points);
}

const rankingPolicy = Object.freeze({
 scope:'approved_school_and_paper4_first_ac',
 bonusIncluded:false,
 retroactive:false,
 order:['points_desc','ac_rate_desc','luq_balance_desc'],
 ties:'equal_points_ac_rate_and_luq_balance',
 description:'排名积分包含审核公开的普通题首次有效 AC、Paper 4 正式交卷后每道大题首次通过全部自动测试的 10 分，以及已启用奖励的 ACSL 试卷所得积分。积分相同时比较未四舍五入的首解 AC 率，暂无有效统计样本者排在已有首解 AC 率者之后。普通练习与作业按同一学生和题目版本统计至首个有效 AC，限时训练与 Paper 4 按正式提交统计。积分和首解 AC 率均相同时比较当前奖学金余额，三项均相同则并列。',
});

export async function handleOwnPoints({pool,user,route,method}) {
 if(route!=='/points/me'||method!=='GET')return null;
 const points=await platformPoints(pool,user.id);
 return {status:200,body:{points,rankPoints:points,rankingPolicy}};
}
