# Example suite: support-agent

The demo dataset for `llmreg` — a synthetic customer-support case set for a
fictional outdoor-gear retailer, **NovaVey** (the same name as this repo's
org; there is no real NovaVey customer data anywhere in this suite). It
exists to give the loader, the runner, the comparison engine, and eventually
the CI check something real to load and to fail on. This document describes
**only the dataset** (`dataset.json`) — the two prompt variants (baseline /
candidate) that get compared against it are Phase 10 work and are not part
of this file or this phase.

## Synthetic content — read this first

**Every case in `dataset.json` is invented.** No real customer messages, no
real names, no real order numbers, no real account numbers, no real email
addresses, no real phone numbers. Order numbers follow an obviously-synthetic
pattern (`ORD-77xxxxx`), subscription IDs follow `SUB-44xxx`, wholesale
account references follow `WHC-xxxx`, and customer names used in scripted
assistant turns (e.g. "Jordan") are generic first names with no surname or
identifying detail attached. If any of this ever looks like it resembles a
real person, order, or company, that is coincidence, not sourcing — nothing
here was derived from real support transcripts.

## What's in `dataset.json`

A single top-level JSON array of exactly **240** case objects, matching the
`Case` interface the dataset loader (`packages/core/src/dataset`) validates
against:

```ts
interface Case {
  externalId: string;
  input: { messages: Array<{ role: "user" | "assistant"; content: string }> };
  expected: unknown | null;
  tags: string[];
  critical: boolean;
  criticalReason: string | null;
}
```

- **`expected` is `null` on all 240 cases.** Phase 2 is the dataset and its
  schema, not the grader contract — that lands in Phase 3 (deterministic
  graders) and Phase 5 (the judge). Rather than guess at a grader-input
  shape now and risk it disagreeing with what those phases actually build,
  every case here is scored by whatever grader/judge config the suite
  attaches later. This is the common case anyway per the spec ("most cases
  should be null since scoring comes from later graders/judges").
- **9 cases are multi-turn** — a prior `assistant` turn followed by a `user`
  follow-up — used where the scenario genuinely depends on prior context
  (a promised refund that didn't arrive, a policy already explained once
  that the customer is now pushing back on, an escalation that's already
  been asked for once). The remaining 231 are single-turn `user` messages,
  which is the realistic majority for a support chat's opening message.

## Case count by tag

Every case carries at least one of the five required core tags. Many carry
two or three, where that's realistic (an angry refund request is tagged
both `refunds` and `tone`; a prompt-injection attempt aimed at a refund is
tagged `refunds`, `safety`, and `adversarial`). Counts below are **not
mutually exclusive** — they sum to more than 240 because of that overlap.

| Core tag | Count |
|---|---:|
| `refunds` | 79 |
| `tone` | 64 |
| `safety` | 51 |
| `escalation` | 45 |
| `out-of-scope` | 40 |

Every case also carries exactly one **difficulty tag** (`clean` /
`ambiguous` / `adversarial` / `edge` — see below), and most carry one or
more **granular capability sub-tags** mined from the same distinctions used
to write the case, so a regression can be pointed at something more
specific than "safety broke" — e.g. `prompt-injection`, `self-harm`, `pii`,
`jailbreak`, `phishing`, `fraud-signal`, `policy-boundary`, `chargeback`,
`churn-risk`, `legal-threat`, `medical-advice`, `vulnerable-customer`,
`non-native-speaker`, `low-tech-literacy`, `missing-context`, and others.
Full list and counts are reproducible from the dataset itself; nothing here
is hand-summarized in a way that could drift from the file.

## Case count by difficulty

There is no `difficulty` field in the `Case` interface — difficulty is
encoded as one of four tags (`clean`, `ambiguous`, `adversarial`, `edge`),
alongside the core tags, per the same "add granular tags alongside the
required ones" convention used for capability sub-tags.

| Difficulty | Count | What it means here |
|---|---:|---|
| `clean` | 62 | Well-formed, complete, unambiguous — a single clear ask with the context needed to resolve it. |
| `ambiguous` | 58 | Missing a detail the agent has to ask for or infer (no order number, unclear which of two orders, a vague item description, contradictory information) rather than a case with an obvious resolution. |
| `adversarial` | 87 | The customer is actively trying to get a specific outcome the agent shouldn't just grant — a policy bypass, a prompt injection, a fabricated authority claim, a chargeback-plus-refund double-dip, a guilt-trip, a fraud pattern. |
| `edge` | 33 | A legitimate boundary condition, not an attempt to manipulate — exactly-at-window refunds, a deceased relative's account, a minor's unsupervised purchase, an international customs question. |

**This suite is deliberately not 240 easy cases.** 178 of 240 (74%) are
`ambiguous`, `adversarial`, or `edge` — the three categories where a
plausible, competent prompt can genuinely get the wrong answer. Only 62
(26%) are the kind of clean, complete request that most support-agent
prompts already handle correctly.

Cross-tab (core tag × difficulty; a case can appear in more than one core
tag's row):

| | clean | ambiguous | adversarial | edge |
|---|---:|---:|---:|---:|
| `refunds` | 31 | 21 | 13 | 14 |
| `escalation` | 8 | 9 | 18 | 10 |
| `out-of-scope` | 14 | 9 | 16 | 1 |
| `tone` | 5 | 22 | 27 | 10 |
| `safety` | 5 | 3 | 36 | 7 |

`safety` skews heavily adversarial by design — most of what makes a safety
case worth having is that someone is trying to get the agent to do the
unsafe thing (jailbreak, injection, phishing, fraud), not that safety
questions are inherently ambiguous. The 5 `safety` + `clean` cases are
legitimate, non-adversarial safety questions (age ratings, safe-usage
distances, recall checks) included so the suite doesn't only measure
refusal behavior — an agent that refuses everything tagged `safety` would
pass the adversarial cases and fail these.

## The 30 critical cases

30 of 240 cases (12.5%) are marked `critical: true`. Per §5.6, any single
critical case regressing fails the whole comparison regardless of the
aggregate statistic — so this flag is expensive to hand out, and every one
of the 30 has a specific, non-generic `criticalReason` recorded in the
dataset itself (not "important" — a concrete account of what a wrong answer
actually costs). Breakdown by what kind of stakes they protect:

| Category | Count | The failure mode being protected against |
|---|---:|---|
| Refund policy integrity | 9 | Wrong handling directly moves money outside policy: granting a stale-claim refund with no defect and no prior contact, a fraud-shaped "delivered but denied" claim, a "let me keep it and refund me anyway" request, a double-dip chargeback-plus-refund, a final-sale item with a genuine defect (a real compliance question, not just a policy call), a prompt-injection that tries to override refund policy outright, and an unverifiable "your supervisor already approved this" claim. |
| Escalation routing for real stakes | 8 | Cases where treating a serious situation as routine has real consequences: a product-liability injury with a stated legal contact, a wholesale account alleging contract breach, a stated intent to file a regulatory complaint over an auto-renewal disclosure issue, a ~50-subscription enterprise account threatening to leave, a likely account-compromise with unauthorized charges, a customer whose distress phrasing sits close to a crisis disclosure, a request for medical drug-interaction advice, and a request for legal liability advice for a business context. |
| Safety — self-harm, injection, PII, jailbreak, fraud, phishing | 13 (some also counted above where a case carries both `safety` and `refunds`/`escalation`) | The highest-stakes category by construction: 3 self-harm disclosures (direct, tangential, and third-party), 2 system-prompt-extraction attempts, a fake-authority jailbreak, 2 PII-disclosure attempts (another customer's order, a full stored card number), a veiled physical threat referencing a real-world location, an insurance-fraud document request, and a phishing-link "should I enter my card" question. |

The exact 30, with tags, are reproducible directly from the dataset
(`jq '[.[] | select(.critical)] | length'` → `30`); each object's own
`criticalReason` field is the authoritative explanation, not this table —
this table exists so a reviewer doesn't have to open the file to see the
shape of the set.

**Distribution note:** critical cases skew toward `safety` and `refunds`
because those are the two tags where a wrong answer has a direct, arguable
cost (money, legal exposure, physical safety) rather than a degraded
experience. `tone` (3 critical) and `out-of-scope` (3 critical) have far
fewer — a purely unsympathetic tone or a purely off-topic answer is a real
quality problem worth measuring in the aggregate, but on its own it rarely
clears the bar of "this one case failing should block the whole check,"
and the three that do are ones where tone/scope intersects with an actual
privacy or liability question (a deceased relative's account access, a
medical drug-interaction question, a business legal-liability question).

## Coverage gaps — named, not claimed away

- **English only, with light code-switching.** A handful of cases use
  broken English or a mixed-language sentence (`tone-nonnative-*`,
  `escalation-language-barrier-*`), but there are no cases written entirely
  in another language. A production suite for a genuinely multilingual
  support surface would need a parallel set in each supported language,
  not just English messages implying non-native origin.
- **Multi-turn depth is shallow.** The 9 multi-turn cases are all exactly
  3 turns (user → assistant → user). Real support conversations sometimes
  run much longer, and an agent that handles turn 3 well but drifts by
  turn 8 (losing track of an earlier constraint, re-asking for information
  already given) is a failure mode this suite cannot currently see at all.
- **No tool-use or retrieval-grounded cases.** This suite treats the
  support agent as a single text-in/text-out turn. If the real target
  agent looks up order status via a tool call or retrieves policy text
  from a knowledge base, none of these 240 cases exercise whether it calls
  the right tool, handles a tool error, or grounds its answer in retrieved
  text rather than a hallucinated policy detail.
- **Sparse per-sub-tag counts limit what can be localized statistically.**
  The core tags (40–79 cases each) and difficulty tags (33–87 each) have
  enough cases for the comparison engine's paired statistics to say
  something meaningful. Several granular sub-tags do not — `policy-bypass`
  has 1 case, `confidential-info` has 2, `account-security` has 2,
  `gift-order` has 2. A regression concentrated in one of those sub-tags
  will still surface (each such case is critical or sits inside a larger
  tag), but the sub-tag itself is too small a sample for its own
  paired-bootstrap CI to be worth reporting in isolation — treat the
  granular tags as a way to *locate* a case a human should read, not as
  their own statistically independent slices.
- **No cases with attachments/images.** Several scenarios reference "I can
  send photos" or a damaged item — the suite tests how the agent responds
  to that claim in text, not a real multimodal case with an actual image
  attached, since the target interface here is text chat.
- **Every case is a single fictional company's policy.** All 240 cases
  assume one consistent (if never fully written out) NovaVey return/refund
  /subscription policy. That consistency is intentional — it lets a grader
  or judge be built against one policy — but it means the suite doesn't
  test policy ambiguity or conflicting-policy-document scenarios, which are
  common in real support settings with legacy documentation.

## Reproducing the counts in this file

Every number above was computed from `dataset.json` directly, not
hand-tallied while writing cases (an earlier draft of this dataset had a
hand-planned tag distribution that turned out to be off by several cases
once actually counted — the numbers here are the corrected, verified
ones). To re-verify:

```bash
node -e '
const data = require("./dataset.json");
console.log("total:", data.length);
console.log("critical:", data.filter(c => c.critical).length);
const tags = {};
for (const c of data) for (const t of c.tags) tags[t] = (tags[t]||0)+1;
console.log(tags);
'
```
