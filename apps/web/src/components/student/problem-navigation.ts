export interface NavigationProblem { problemId: string; versionId?: string; title?: string }
export interface NavigationContext { learningPathId?: string | null; chapterId?: string | null; assignmentId?: string | null; timedPracticeId?: string | null; returnTo?: string | null; sourceLabel?: string | null }
/** An outside workspace may enter the library at its first problem; known positions never wrap. */
export function problemNavigation(items: NavigationProblem[], current: string, { enterFromOutside = false }: { enterFromOutside?: boolean } = {}) {
  const unique=items.filter((item,index)=>item.problemId&&items.findIndex(other=>other.problemId===item.problemId)===index);
  const index=unique.findIndex(item=>item.problemId===current);
  return { previous:index>0?unique[index-1]:null,next:index>=0&&index<unique.length-1?unique[index+1]:index<0&&enterFromOutside?unique[0]??null:null,random:unique.filter(item=>item.problemId!==current) };
}
export function navigationHref(target: NavigationProblem, context: NavigationContext) {
  const query=new URLSearchParams();
  if(target.versionId)query.set('versionId',target.versionId);
  if(context.learningPathId&&context.chapterId){query.set('learningPathId',context.learningPathId);query.set('chapterId',context.chapterId);}
  if(context.assignmentId)query.set('assignmentId',context.assignmentId);
  if(context.timedPracticeId)query.set('timedPracticeId',context.timedPracticeId);
  if(context.returnTo?.startsWith('/student/')&&!context.returnTo.startsWith('//'))query.set('returnTo',context.returnTo);
  if(context.sourceLabel)query.set('sourceLabel',context.sourceLabel);
  return `/student/problems/${encodeURIComponent(target.problemId)}${query.size?'?'+query:''}`;
}
