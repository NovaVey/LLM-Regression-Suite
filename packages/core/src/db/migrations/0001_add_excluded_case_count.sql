-- Phase 7: the report layer needs to show how many cases were excluded from
-- a comparison (errored on one side, or missing entirely) alongside the
-- paired count and critical-regressed count that were already stored --
-- this was computed at compare time (compareRuns's pairing.excluded.length)
-- but never persisted, so it was unrecoverable once the CLI process exited.
-- Same shape as the existing paired_case_count/critical_regressed columns:
-- an aggregate count, not the full excluded-case list (which stays
-- ephemeral, reported only in the CLI's own immediate output, same as
-- before this migration).
alter table comparisons add column excluded_case_count int not null default 0;
