-- Display labels may change without mutating a published question or answer.
ALTER TABLE paper4_papers ADD COLUMN short_title text NOT NULL DEFAULT '' CHECK(char_length(short_title)<=60);
UPDATE paper4_papers p SET short_title=CASE
 WHEN v.definition->'exam'->>'examYear' ~ '^[0-9]{4}$'
  AND v.definition->'exam'->>'examVariant' IN ('41','42','43')
  AND v.definition->'exam'->>'examSession' IN ('summer','autumn')
 THEN '9618/'||(v.definition->'exam'->>'examVariant')||' '||
  CASE WHEN v.definition->'exam'->>'examSession'='summer' THEN 'mj' ELSE 'on' END||' '||
  right(v.definition->'exam'->>'examYear',2)
 ELSE left(btrim(p.title),60) END
 FROM paper4_versions v WHERE v.id=p.current_version_id;
