# Delivery

This is a fixed-scope offer to build this tool against your own product, not a pitch for this repo's public example. It exists because the code above is reusable, but the thing that actually makes it trustworthy — a dataset built from your real traffic, tags your team recognizes, and a judge validated against your team's own labels — isn't something I can hand you off the shelf. That part has to be built with you.

## The opener

Before any of this: what size regression can your current eval already detect? Almost nobody knows, and most eval sets are far too small to see anything smaller than 15-20 points. Computing that one number from whatever data you already have takes about twenty minutes, and it's free — it's also usually the moment a "we have evals" conversation becomes "we have evals that can't see anything under 15 points," which is the actual conversation worth having before scoping anything bigger.

## Deliverables

- An eval dataset built from your real traffic (anonymized), tagged with your team's own categories and critical-case flags — not a generic template.
- Graders for your quality dimensions: deterministic where the answer is checkable, an LLM judge where it isn't.
- The judge calibrated against your team's own labels, with kappa reported — not assumed, not eyeballed.
- CI integration posting the comparison on every PR that touches your prompts.
- The simulation suite (null model, power curve, MDE validation) run against *your* data, so you know precisely what your dataset can and cannot detect before you start trusting it.
- A handover session: how to read a verdict, how to add a case, how to re-calibrate when a rubric changes.

## Timeline

2–3 weeks. Week 1 is dataset construction and labeling, done with your team, not for your team — the labels are the part of this that has to come from people who know what "good" means for your product.

## What I need from you

- 200+ real inputs (anonymized is fine — no real customer PII needs to leave your systems for this).
- Your current production prompt(s).
- Someone who can label around 150 outputs, roughly 3 hours of their time, stratified across your dataset's tags (see [`docs/JUDGES.md`](JUDGES.md) for what labeling actually involves).
- Repo access for the CI integration.

## Out of scope

- Production observability — this is a pre-merge CI check, not a runtime monitoring product.
- Model fine-tuning.
- Dataset labeling done by me alone, without your domain input. The labels are the product here; having someone outside your team invent them defeats the entire point of calibration.
- Multi-model routing decisions.

## Acceptance

- The suite runs on every PR against your prompts.
- The null model reports a false alarm rate within tolerance, measured on your data, not just this repo's synthetic example.
- The power curve tells your team, in plain numbers, what size regression your dataset can and cannot catch — the single most useful sentence this whole engagement produces.
