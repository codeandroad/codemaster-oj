-- Keep the existing bonus rows as conversion receipts and retain
-- their award-time eligibility, caps and uniqueness rules.
LOCK TABLE point_ledger IN SHARE ROW EXCLUSIVE MODE;

DROP TRIGGER luq_ledger_student_award_notice ON luq_ledger;
CREATE TRIGGER luq_ledger_student_award_notice
 AFTER INSERT ON luq_ledger FOR EACH ROW
 WHEN (NEW.kind IN ('admin_grant', 'activity') AND NEW.delta > 0
   AND NOT (NEW.metadata @> '{"historicalPointBonus":true}'::jsonb))
 EXECUTE FUNCTION notify_student_scholarship_ledger();

CREATE FUNCTION post_activity_point_bonus(bonus point_ledger, historical boolean) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM luq_post_entry(bonus.identity_id, bonus.points, 'activity',
  'legacy-point-bonus:' || bonus.id, NULL,
  CASE WHEN historical THEN 'Historical activity bonus conversion' ELSE 'Activity problem bonus' END,
  jsonb_build_object('activityType', bonus.reason, 'activityId', COALESCE(bonus.assignment_id, bonus.timed_practice_id),
   'problemId', bonus.problem_id, 'pointLedgerId', bonus.id::text, 'historicalPointBonus', historical));
END $$;
REVOKE ALL ON FUNCTION post_activity_point_bonus(point_ledger,boolean) FROM PUBLIC, campus_app, campus_worker;

DO $$
DECLARE bonus point_ledger;
BEGIN
 FOR bonus IN SELECT * FROM point_ledger WHERE reason IN ('assignment','timed') AND points > 0 ORDER BY identity_id,id LOOP
  PERFORM post_activity_point_bonus(bonus, true);
 END LOOP;
END $$;

CREATE FUNCTION post_new_activity_point_bonus() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM post_activity_point_bonus(NEW, false);
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION post_new_activity_point_bonus() FROM PUBLIC, campus_app, campus_worker;
CREATE TRIGGER point_ledger_bonus_scholarship
 AFTER INSERT ON point_ledger FOR EACH ROW
 WHEN (NEW.reason IN ('assignment','timed') AND NEW.points > 0)
 EXECUTE FUNCTION post_new_activity_point_bonus();
