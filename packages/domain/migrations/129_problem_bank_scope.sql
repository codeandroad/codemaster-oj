-- Catalog execution snapshots and ACSL banks are service-managed. Ordinary
-- authoring is available in each school's own banks.
ALTER TABLE school_problem_banks DROP CONSTRAINT school_problem_banks_resource_kind_check;
ALTER TABLE school_problem_banks ADD CHECK (resource_kind IN ('ordinary','acsl','publication'));
UPDATE school_problem_banks SET resource_kind='publication'
WHERE school_id='00000000-0000-4000-8000-000000000052'
  AND id='00000000-0000-4000-8000-000000000074' AND request_id=id AND resource_kind='ordinary';
ALTER TABLE school_problem_banks DROP CONSTRAINT school_problem_banks_legacy_snapshot_check;
