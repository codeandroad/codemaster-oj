// Staff catalog rows need publication and permission metadata, not lesson
// bodies, reference implementations, starter programs or sample data.
export const problemListColumns = alias => ['id','problem_id','title','mode','tags','source','published_at',
 'school_visible_at','rank_review_status','rank_approved_at','validation_status','validation_message','created_at']
 .map(column=>`${alias}.${column}`).join(',')+`,jsonb_build_object('difficulty',${alias}.metadata->'difficulty') metadata`;

export function problemListSummary(row) {
 return {id:row.problem_id,title:row.title,mode:row.mode,difficulty:typeof row.metadata?.difficulty==='string'?row.metadata.difficulty:undefined,
  statementLanguage:row.statement_language,publicStatementPending:row.public_statement_pending,
  tags:row.tags??[],source:row.source??'',versionId:row.id,
  publishedVersionId:row.published_version_id||(row.published_at?row.id:null),
  publishedTitle:row.published_title||(row.published_at?row.title:null),published:!!row.published_at,
  schoolVisibleAt:row.school_visible_at??null,rankReviewStatus:row.rank_review_status??'pending',
  rankApprovedAt:row.rank_approved_at??null,bankVisibility:row.bank_visibility,
  validationStatus:row.validation_status,validationMessage:row.validation_message??null,
  formalTestCount:row.formal_test_count===undefined?undefined:Number(row.formal_test_count),
  canPublish:row.validation_status==='AC'&&!row.published_at};
}
