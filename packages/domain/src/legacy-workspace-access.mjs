import { fail } from './security.mjs';

// These are login/self-service endpoints, not a general auth-prefix exemption.
// New workspaces authorize their own school IDs inside their handlers. Every
// remaining legacy business route belongs to the original school until that
// route has been explicitly converted to school-scoped access.
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

export async function requireLegacyWorkspaceAccess(db, user, route, method) {
  if (SHARED_ENDPOINTS.has(`${method} ${route}`)
    || (method === 'GET' && route === '/account-notifications')
    || (method === 'POST' && /^\/account-notifications\/(read-all|[^/]+\/read)$/.test(route))
    || /^\/schools(?:\/|$)/.test(route)
    || /^\/practice(?:\/|$)/.test(route)
    || /^\/platform(?:\/|$)/.test(route)) return;
  if (!user) fail(401, 'UNAUTHENTICATED', '请先登录');
  const { rowCount } = await db.query(
    'SELECT 1 FROM legacy_school_account_ownership WHERE account_id=$1', [user.id],
  );
  if (!rowCount) {
    fail(403, 'LEGACY_WORKSPACE_REQUIRED', '此入口属于原学校，请从当前学校工作区访问已开放的功能');
  }
  // Credential profiles of personal and other-school users never belong to
  // this school's people directory, even if an administrator guesses an ID.
  const target=route.match(/^\/(people|accounts)\/([0-9a-f-]{36})(?:\/|$)/i);
  if(target && method==='GET') {
    const table=target[1]==='people'?'legacy_school_identity_ownership':'legacy_school_account_ownership';
    const column=target[1]==='people'?'identity_id':'account_id';
    if(!(await db.query(`SELECT 1 FROM ${table} WHERE ${column}=$1`,[target[2]])).rowCount)
      fail(404,'NOT_FOUND','资源不存在');
  }

}
