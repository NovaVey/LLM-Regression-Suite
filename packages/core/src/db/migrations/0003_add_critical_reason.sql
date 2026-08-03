-- Phase 9: the Dataset and Case diff screens need to show WHY a case is
-- critical (§5.6: "that power has to be earned with a written reason, not
-- 'important'"), not just the boolean flag. dataset/load.ts already
-- validates every critical case has a non-empty criticalReason at ingest
-- time -- it was just never carried into the `cases` table, same shape of
-- gap as excluded_case_count (0001) and the confusion matrix (0002).
alter table cases add column critical_reason text;
