export function activityDate(value:string,label:string){if(!value)throw new Error(`请填写${label}。`);const date=new Date(value);if(!Number.isFinite(date.getTime()))throw new Error(`${label}格式无效。`);return date.toISOString();}
export function validateActivity({title,classId,problems,participants,publish=false,timed=false}:{title:string;classId:string;problems:{problemId:string;points:number;rewardPoints?:number}[];participants:string[];publish?:boolean;timed?:boolean}){
 if(!title.trim())throw new Error('请填写活动名称。');if(!classId)throw new Error('请选择班级。');
 if(problems.length>50||new Set(problems.map(p=>p.problemId)).size!==problems.length)throw new Error('最多选择 50 道题目，同一题目不能重复。');
 if(problems.some(p=>!Number.isFinite(p.points)||p.points<=0||p.points>1000||Math.abs(p.points*100-Math.round(p.points*100))>0.00001))throw new Error('题目分值须大于 0、不超过 1000，最多两位小数。');
 if(problems.some(p=>p.rewardPoints!==undefined&&(!Number.isInteger(p.rewardPoints)||p.rewardPoints<0||p.rewardPoints>20)))throw new Error('本作业额外奖励须为 0–20 的整数积分。');
 if(problems.reduce((sum,p)=>sum+(p.rewardPoints??0),0)>100)throw new Error('本作业额外奖励合计最多 100 积分。');
 if((publish||timed)&&!problems.length)throw new Error('请至少选择一道已发布题目。');if((publish||timed)&&!participants.length)throw new Error('请至少选择一名适用学生。');
 if(participants.length>500)throw new Error('适用学生最多 500 名。');
}
export function validateTimedDates(starts:string,ends:string,duration:number,now=Date.now(),allowPast=false){const start=activityDate(starts,'开始时间'),end=activityDate(ends,'结束时间');if(Date.parse(end)<=Date.parse(start))throw new Error('结束时间须晚于开始时间。');if(!allowPast&&Date.parse(end)<=now)throw new Error('结束窗口已过期，发布前请将结束时间设置为晚于当前时间。');if(!Number.isInteger(duration)||duration<1||duration>240)throw new Error('个人时长须为 1–240 分钟的整数。');return {start,end};}
export function activeParticipants(details?:{identityId:string;exempt:boolean}[],fallback:string[]=[]){return details?details.filter(p=>!p.exempt).map(p=>p.identityId):fallback;}
