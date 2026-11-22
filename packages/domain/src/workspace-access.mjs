import { fail, uuid } from './security.mjs';

const SHARED_ENDPOINTS = new Set([
  'GET /site-info',
  'GET /auth/me',
  'GET /points/me',
  'GET /auth/activation-schools',
  'POST /auth/login',
  'POST /auth/logout',
  'POST /auth/register',
  'POST /auth/register-personal',
  'POST /auth/reset',
  'POST /auth/verify-identity',
  'PATCH /auth/profile',
  'GET /auth/default-workspace',
  'PATCH /auth/default-workspace',
  'POST /school-invitations/accept',
]);

export async function requireWorkspaceRoute(user, route, method) {
  if (SHARED_ENDPOINTS.has(`${method} ${route}`)
    || (method === 'GET' && route === '/account-notifications')
    || (method === 'POST' && /^\/account-notifications\/(read-all|[^/]+\/read)$/.test(route))
    || /^\/schools(?:\/|$)/.test(route)
    || /^\/practice(?:\/|$)/.test(route)
    || /^\/presence(?:\/|$)/.test(route)
    || /^\/platform(?:\/|$)/.test(route)) return;
  if (!user) fail(401, 'UNAUTHENTICATED', '请先登录');
  fail(410, 'SCHOOL_WORKSPACE_REQUIRED', '请从已加入的学校工作区打开此功能');
}

// Resolve bookmarks from the single-school site through the same handlers as
// current links. Membership is rechecked in the destination transaction.
export async function schoolBookmark(pool, user, route, method, url) {
 if (!user || method !== 'GET') return null;
 const resource = route.match(/^\/(problems|submissions)(?:\/([^/]+))?(\/submissions)?$/);
 if (!resource && !['/classes','/people','/assignments','/timed-practices','/learning-paths'].includes(route)) return null;
 const requested = url.searchParams.get('workspaceSchoolId') ?? url.searchParams.get('schoolId');
 const {rows} = await pool.query('SELECT school_id FROM school_memberships WHERE account_id=$1 AND revoked_at IS NULL ORDER BY school_id',[user.id]);
 const schoolId = requested ?? user.defaultSchoolId ?? (rows.length===1?rows[0].school_id:null);
 if(!schoolId || !rows.some(row=>row.school_id===schoolId))fail(404,'WORKSPACE_REQUIRED','请从已加入的学校打开此记录');
 if(resource){
  const [,kind,id,suffix]=resource;
  if(kind==='problems' && id && !url.searchParams.has('assignmentId') && !url.searchParams.has('timedPracticeId')){
   if((await pool.query("SELECT 1 FROM problems WHERE id=$1 AND owner_scope='platform'",[uuid(id)])).rowCount){
    url.searchParams.set('workspaceSchoolId',schoolId);
    return '/practice/problems/'+id+(suffix??'');
   }
  }
  if(kind==='problems'&&(url.searchParams.has('assignmentId')||url.searchParams.has('timedPracticeId')))return null;
  return '/schools/'+schoolId+'/'+(kind==='submissions'&&id?'judge-jobs':kind)+(id?'/'+id:'')+(suffix??'');
 }
 const section={'/classes':'classes','/people':'identities','/assignments':'activities','/timed-practices':'activities','/learning-paths':'courses'}[route];
 if(section==='activities')url.searchParams.set('kind',route==='/assignments'?'assignment':'timed');
 return '/schools/'+schoolId+'/'+section;
}
