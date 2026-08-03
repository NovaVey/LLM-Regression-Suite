#!/usr/bin/env node
/**
 * Orchestrates one comparison run for the composite action (action.yml):
 * path-filter (skip entirely if the PR doesn't touch the suite), extract
 * the baseline system prompt from git history, run baseline + candidate,
 * compare, render the PR comment, and find-or-update it on the PR via the
 * GitHub REST API.
 *
 * Deliberately dependency-free: no @actions/core, no @actions/github, no
 * octokit. Composite-action inputs arrive as INPUT_<NAME> env vars (set
 * explicitly in action.yml's final step -- composite actions must forward
 * `${{ inputs.x }}` into env themselves, unlike JS/Docker actions where the
 * runtime does it automatically), and the GitHub REST API is called with
 * Node 20's built-in fetch. This script lives inside the same repo/
 * monorepo it orchestrates, not a published package, so it imports
 * directly from the sibling packages' built dist output via relative
 * paths rather than adding a new npm workspace member.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runRunCommand } from '../../packages/cli/dist/commands/run.js';
import { runCompareCommand } from '../../packages/cli/dist/commands/compare.js';
import { runReportCommand } from '../../packages/cli/dist/commands/report.js';
import { closeDb, PR_COMMENT_MARKER, UncalibratedJudgeError } from '../../packages/core/dist/index.js';

function input(name) {
  const key = `INPUT_${name.toUpperCase().replace(/-/g, '_')}`;
  const value = process.env[key];
  return value !== undefined && value !== '' ? value : undefined;
}

function requireInput(name) {
  const value = input(name);
  if (value === undefined) {
    throw new Error(`Missing required input: ${name}`);
  }
  return value;
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

/** Shallow checkouts (the GitHub Actions default) may not have every commit an older PR base sha points at -- fetch it specifically rather than requiring every caller to set fetch-depth: 0. */
function ensureShaAvailable(sha) {
  try {
    execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`]);
  } catch {
    execFileSync('git', ['fetch', '--depth=1', 'origin', sha], { stdio: 'inherit' });
  }
}

async function postOrUpdateComment(token, body) {
  const [owner, repo] = (process.env.GITHUB_REPOSITORY ?? '').split('/');
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!owner || !repo || !eventPath || !existsSync(eventPath)) {
    console.log('Not running in a recognizable PR context (GITHUB_REPOSITORY/GITHUB_EVENT_PATH missing) -- printing the report instead of posting it:\n');
    console.log(body);
    return;
  }
  const event = JSON.parse(readFileSync(eventPath, 'utf8'));
  const issueNumber = event.pull_request?.number ?? event.number;
  if (!issueNumber) {
    console.log('No pull_request number in the event payload -- printing the report instead of posting it:\n');
    console.log(body);
    return;
  }

  const apiBase = process.env.GITHUB_API_URL ?? 'https://api.github.com';
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  // Find an existing comment carrying our marker -- §5.8: "The comment
  // updates in place on new commits rather than posting again -- twelve
  // stacked bot comments is how a bot gets muted."
  let existingCommentId = null;
  for (let page = 1; ; page++) {
    const res = await fetch(`${apiBase}/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=100&page=${page}`, { headers });
    if (!res.ok) {
      throw new Error(`GitHub API error listing comments: ${res.status} ${await res.text()}`);
    }
    const comments = await res.json();
    const marked = comments.find((c) => typeof c.body === 'string' && c.body.includes(PR_COMMENT_MARKER));
    if (marked) {
      existingCommentId = marked.id;
      break;
    }
    if (comments.length < 100) break;
  }

  if (existingCommentId !== null) {
    const res = await fetch(`${apiBase}/repos/${owner}/${repo}/issues/comments/${existingCommentId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ body }),
    });
    if (!res.ok) {
      throw new Error(`GitHub API error updating comment: ${res.status} ${await res.text()}`);
    }
    console.log(`Updated existing PR comment ${existingCommentId}.`);
  } else {
    const res = await fetch(`${apiBase}/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ body }),
    });
    if (!res.ok) {
      throw new Error(`GitHub API error creating comment: ${res.status} ${await res.text()}`);
    }
    console.log('Created a new PR comment.');
  }
}

async function main() {
  const suiteDir = requireInput('suite');
  const baselineSha = requireInput('baseline');
  const candidateSha = requireInput('candidate');
  const failOn = (input('fail-on') ?? 'regression').split(',').map((s) => s.trim()).filter(Boolean);
  const limit = input('limit');
  const githubToken = input('github-token');

  const suitePath = join(suiteDir, 'suite.json');
  const datasetPath = join(suiteDir, 'dataset.json');
  const promptPath = join(suiteDir, 'system-prompt.txt');

  console.log(`llmreg action: suite=${suiteDir} baseline=${baselineSha} candidate=${candidateSha} fail-on=${failOn.join(',')}`);

  // --- Path filtering: skip entirely if nothing under the suite changed ---
  // §9 Phase 8 exit criteria: "a PR that edits the README produces no
  // comparison run at all."
  ensureShaAvailable(baselineSha);
  ensureShaAvailable(candidateSha);
  const changedFiles = git(['diff', '--name-only', baselineSha, candidateSha, '--', suiteDir])
    .split('\n')
    .filter(Boolean);
  if (changedFiles.length === 0) {
    console.log(`No changes under ${suiteDir} between ${baselineSha} and ${candidateSha} -- skipping, no comparison run.`);
    return;
  }
  console.log(`Changed files under ${suiteDir}:\n  ${changedFiles.join('\n  ')}`);

  const runOptions = {
    suite: suitePath,
    dataset: datasetPath,
    cache: true,
    ...(limit !== undefined ? { limit: Number(limit) } : {}),
  };

  // Tracks what should decide the job's exit code -- either a real verdict
  // string (regression|no_detectable_difference|improvement_detected|
  // insufficient_data) or one of the failure-to-even-compare states, all
  // documented in action.yml's fail-on input.
  let outcomeForExitCode;
  let commentBody;

  // Wraps everything from baseline-prompt extraction through the compare
  // and report calls: §5.9 says "the check fails loudly, never silently,"
  // and that has to hold for every way this pipeline can fail, not just
  // an uncalibrated judge -- a suite that's brand new at the baseline sha
  // (git show fails: nothing to extract), a target API outage mid-run, or
  // an uncalibrated judge should all end with a real, explanatory PR
  // comment, never a bare red Actions log nobody reading the PR ever opens.
  try {
    const tmpDir = mkdtempSync(join(tmpdir(), 'llmreg-action-'));
    const baselinePromptPath = join(tmpDir, 'baseline-system-prompt.txt');
    let baselinePromptContent;
    try {
      baselinePromptContent = git(['show', `${baselineSha}:${promptPath}`]);
    } catch (err) {
      const stderr = err && typeof err === 'object' && 'stderr' in err ? String(err.stderr) : '';
      if (stderr.includes('exists on disk, but not in') || stderr.includes('does not exist in')) {
        throw new Error(
          `\`${promptPath}\` doesn't exist yet at the baseline commit (${baselineSha.slice(0, 12)}) -- this looks like the suite is being introduced for the first time in this PR, so there's no prior version to compare against.`,
        );
      }
      throw err;
    }
    writeFileSync(baselinePromptPath, baselinePromptContent, 'utf8');

    console.log('Running baseline...');
    const baselineOutcome = await runRunCommand({ ...runOptions, label: baselineSha, systemPromptFile: baselinePromptPath });
    console.log(
      `  baseline run ${baselineOutcome.runId}: ${baselineOutcome.caseCount} cases, ${baselineOutcome.errorCount} errors, cache hit rate ${(baselineOutcome.cacheHitRate * 100).toFixed(1)}%`,
    );

    console.log('Running candidate...');
    const candidateOutcome = await runRunCommand({ ...runOptions, label: candidateSha, systemPromptFile: promptPath });
    console.log(
      `  candidate run ${candidateOutcome.runId}: ${candidateOutcome.caseCount} cases, ${candidateOutcome.errorCount} errors, cache hit rate ${(candidateOutcome.cacheHitRate * 100).toFixed(1)}%`,
    );

    const comparisonOutcome = await runCompareCommand({
      suite: suitePath,
      baselineRun: baselineOutcome.runId,
      candidateRun: candidateOutcome.runId,
    });
    outcomeForExitCode = comparisonOutcome.verdict;
    const { rendered } = await runReportCommand({ comparisonId: comparisonOutcome.comparisonId, format: 'markdown' });
    commentBody = rendered;
    console.log(`Comparison ${comparisonOutcome.comparisonId}: verdict=${comparisonOutcome.verdict}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof UncalibratedJudgeError) {
      outcomeForExitCode = 'uncalibrated-judge';
      commentBody = `${PR_COMMENT_MARKER}\n\n**Could not compute a verdict: judge not calibrated.**<br>\n${message}`;
    } else {
      outcomeForExitCode = 'infrastructure-failure';
      commentBody = `${PR_COMMENT_MARKER}\n\n**Could not compute a verdict: infrastructure failure.**<br>\n${message}`;
    }
    console.error(message);
  }

  if (githubToken) {
    await postOrUpdateComment(githubToken, commentBody);
  } else {
    console.log('No github-token provided -- printing the report instead of posting it:\n');
    console.log(commentBody);
  }

  await closeDb();

  if (failOn.includes(outcomeForExitCode)) {
    console.error(`Failing the check: outcome "${outcomeForExitCode}" is in fail-on (${failOn.join(',')}).`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exitCode = 3;
});
