// Compare all pre-existing records, including those in the reconstructed
// school. Inserts are expected only in these destinations and only in that school.
const destinations = [
 'school_memberships','school_administrators','school_identities','school_classes','school_class_roster','school_audit_events',
 'school_scholarship_settings','school_scholarship_accounts','school_scholarship_entitlements','school_scholarship_claims',
 'school_scholarship_activity_awards','school_problem_banks','school_problems','school_problem_versions','school_courses',
 'school_learning_resources','school_course_publications','school_course_classes','school_course_publication_classes','school_course_progress',
 'school_activities','school_activity_problems','school_activity_participants','school_activity_classes','school_activity_attempts',
 'school_paper4_papers','school_paper4_versions','school_paper4_attempts','school_paper4_files','school_paper4_jobs',
 'school_activity_results','school_scholarship_contents','school_scholarship_deliveries','school_scholarship_policies',
 'school_scholarship_activity_rules','school_rank_awards','school_activation_tokens',
];
const originals = {
 account_roles: "SELECT account_id,role FROM account_roles",
 legacy_school_account_ownership: "SELECT * FROM legacy_school_account_ownership",
 legacy_school_identity_ownership: "SELECT * FROM legacy_school_identity_ownership",
};
const migrated = {
 account_roles: "SELECT target_id account_id,substr(action,length('school.role.recorded.')+1) role FROM school_audit_events WHERE action LIKE 'school.role.recorded.%'",
 legacy_school_account_ownership: "SELECT target_id account_id,school_id,created_at assigned_at FROM school_audit_events WHERE action='school.account.affiliation_recorded'",
 legacy_school_identity_ownership: "SELECT target_id identity_id,school_id,created_at assigned_at FROM school_audit_events WHERE action='school.identity.affiliation_recorded'",
};
const nullableAdditions = {
 school_learning_resources:['platform_course_id'],
 school_activity_problems:['reward_points'],
 school_identities:['notes','gender'],school_classes:['description','owner_account_id','leaderboard_fields'],school_activities:['school_course_id','platform_course_id'],
 school_scholarship_entitlements:['platform_entitlement_id','platform_credit_ledger_id'],
 school_scholarship_claims:['platform_ledger_id'],school_scholarship_activity_awards:['platform_ledger_id'],
 school_paper4_jobs:['stage_key'],
};
const quote=value=>"'"+value.replaceAll("'","''")+"'";
const ident=value=>'"'+value.replaceAll('"','""')+'"';
function digest(query,name,rows) {
 return JSON.parse(query(`SELECT jsonb_build_object('table',${quote(name)},'count',count(*),'hash',
  encode(sha256(convert_to(coalesce(string_agg(row::text,chr(10) ORDER BY row::text),''),'UTF8')),'hex')) FROM (${rows}) input`));
}

export function reconstructionKeys(query,schoolId) {
 const indexes=JSON.parse(query(`SELECT jsonb_object_agg(relname,cols) FROM (
  SELECT c.relname,jsonb_agg(a.attname ORDER BY k.ord) cols FROM pg_class c JOIN pg_index i ON i.indrelid=c.oid AND i.indisprimary
  CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(num,ord) JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.num
  WHERE c.relnamespace='public'::regnamespace AND c.relname IN (${destinations.map(quote)}) GROUP BY c.relname) keys`));
 return Object.fromEntries(destinations.map(table=>{
  if(!indexes[table])throw new Error('Missing primary key for '+table);
  const columns=indexes[table].map(ident).join(',');
  const keys=JSON.parse(query(`SELECT coalesce(jsonb_agg(jsonb_build_array(${columns})),'[]'::jsonb)
   FROM ${ident(table)} WHERE school_id=${quote(schoolId)}`));
  return [table,{columns:indexes[table],keys}];
 }));
}

export function reconstructionFingerprints(query,all,schoolId,keys,after) {
 const tables={...all};
 for(const [table,{columns,keys:prior}] of Object.entries(keys)){
  const row=(nullableAdditions[table]??[]).reduce((expr,column)=>
   `(${expr} - CASE WHEN to_jsonb(t)->>${quote(column)} IS NULL THEN ${quote(column)} ELSE '' END)`,'to_jsonb(t)');
  tables[table]=digest(query,table,`SELECT ${row} row FROM ${ident(table)} t WHERE school_id<>${quote(schoolId)}
   OR jsonb_build_array(${columns.map(ident)}) IN (SELECT value FROM jsonb_array_elements(${quote(JSON.stringify(prior))}::jsonb))`);
 }
 for(const [name,sql] of Object.entries(after?migrated:originals)){
  tables[name]=digest(query,name,`SELECT to_jsonb(r) row FROM (${sql}) r`);
 }
 if(!after){
  tables.assignment_preview_receipts={...tables.legacy_assignment_preview_submissions,table:'assignment_preview_receipts'};
  delete tables.legacy_assignment_preview_submissions;
 }
 const history='catalog_course_publication_history';
 if(!after){tables[history]={...tables.legacy_course_publication_versions,table:history};delete tables.legacy_course_publication_versions;}
 const columns=after?"to_jsonb(t)-'catalog_revision'":"to_jsonb(t)-'legacy_revision'";
 tables.public_course_listings=digest(query,'public_course_listings',`SELECT ${columns} || jsonb_build_object('catalog_revision',
  ${after?'catalog_revision':'legacy_revision'}) row FROM public_course_listings t`);
 tables.student_system_notifications=digest(query,'student_system_notifications',`SELECT to_jsonb(t)-'legacy_identity_id' ||
  jsonb_build_object('school_identity_id',coalesce(to_jsonb(t)->>'school_identity_id',to_jsonb(t)->>'legacy_identity_id')) row FROM student_system_notifications t`);
 tables.student_guestbook_messages=digest(query,'student_guestbook_messages',`SELECT to_jsonb(t)-'school_id' ||
  jsonb_build_object('school_id',${after?'t.school_id':`CASE WHEN t.practice_profile_account_id IS NULL THEN ${quote(schoolId)}::uuid END`}) row FROM student_guestbook_messages t`);
 tables.problem_banks=digest(query,'problem_banks',`SELECT to_jsonb(t)-'catalog_scope_id' row FROM problem_banks t`);
 tables.school_problem_publication_requests=digest(query,'school_problem_publication_requests',`SELECT to_jsonb(t)-'catalog_version_id'-'school_version_id' ||
  jsonb_build_object('source',CASE WHEN t.catalog_version_id IS NOT NULL AND EXISTS(SELECT 1 FROM problems p WHERE p.id=t.problem_id AND p.owner_scope='platform') THEN 'platform' ELSE 'school' END)
  row FROM school_problem_publication_requests t`);
 for(const table of ['member_import_batches','identity_import_batches']){
  if(after && query(`SELECT EXISTS(SELECT 1 FROM ${table} WHERE result_ciphertext IS NOT NULL)`)!=='f')
   throw new Error('Expired import credential cache was retained in '+table);
  tables[table]=digest(query,table,`SELECT to_jsonb(t)-'result_ciphertext' row FROM ${table} t`);
 }
 tables.site_settings=digest(query,'site_settings',"SELECT to_jsonb(t)||jsonb_build_object('settings',t.settings-'schoolName') row FROM site_settings t");
 return tables;
}
