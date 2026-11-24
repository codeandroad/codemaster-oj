-- Keep legacy import records immutable. Teachers append a receipt when a new
-- batch of school problem drafts and its destination bank commit together.
CREATE POLICY school_problem_import_receipt ON school_import_history
 AS RESTRICTIVE FOR INSERT TO campus_app WITH CHECK (
  kind='problem_bank' AND bank_id IS NOT NULL AND class_id IS NULL
  AND actor_account_id=nullif(current_setting('campus.account_id',true),'')::uuid
 );
