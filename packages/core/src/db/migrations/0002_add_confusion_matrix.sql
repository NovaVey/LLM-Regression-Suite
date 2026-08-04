-- Phase 9: the Calibration screen needs to show the confusion matrix behind
-- a judge's kappa (per §8's screen 4: "confusion matrix against human
-- labels"), not just the scalar kappa/agreement_rate already stored. This
-- was computed at calibration time (cohensKappa()'s own return value, see
-- packages/cli/src/commands/calibrate.ts) but discarded after the CLI
-- command printed it, same shape of gap as excluded_case_count in
-- migration 0001 -- a value the caller already had, never persisted, and
-- unrecoverable later without reconstructing it (which would be wrong: more
-- labels may have been added since a given historical calibration ran).
alter table judge_calibrations add column both_pass int not null default 0;
alter table judge_calibrations add column human_pass_judge_fail int not null default 0;
alter table judge_calibrations add column human_fail_judge_pass int not null default 0;
alter table judge_calibrations add column both_fail int not null default 0;
