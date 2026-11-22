---
title: "What I would keep, what I would cut: a clean data layer beat a bigger model"
description: "Turning shop views off dropped the same system from 0.579 to 0.173 PA on 1,000 public questions; six lessons from 15 days of DataMate, and what I will check when the private score arrives."
pubDatetime: 2026-11-17T00:00:00Z
kind: concept
series: datamate
part: 11
project: datamate
draft: false
tags: [evaluation, abstention, table-qa]
---

Fifteen days, about 53 full public runs, two submissions. Looking back, most of what helped was not clever: clean the data before the model sees it, let the model skip what it is unsure of, and compare runs question by question. This last post lists what I would do again, what I would not, and what I cannot judge until the private score is out.

## Key results

- **Layer first.** With the shop views off, the same system dropped from **0.579 to 0.173**. Early on, a clean layer lifted Qwen3-14B from **15 to 62** right out of 100; a 32B model without it reached **25**.
- **Abstain is a policy.** A vote gained **+0.117** over one greedy sample, and **+0.070** of that came from abstaining when samples disagreed.
- **Measure paired.** One 1,000-question run moves by about **±0.025**; about **13 %** of answers change between identical runs.
- **Fix the data, not the prompt.** Notes telling the model what to do were acted on **0-2 %** of the time; removing duplicated lines in code moved a run from **−0.014 to +0.425**.
- The harness moved the shipped model from **0.804 to 0.942**; training moved the vote from **0.725 to 0.798**. Both are public numbers; the private score is unknown.

All public scores are PA on the 1,000 public questions, scored with my own labels: the organisers did not release public gold. PA = (correct − wrong) / n; an abstain (skipped question) scores 0, a wrong answer −1.

![Keep, cut, unknown. Keep: clean data layer first (views off 0.173 vs on 0.579); abstain as a policy (vote +0.117, +0.070 from abstaining); measure paired, twice (~13 % of answers move, one run ±0.025); fix the data, not the prompt (dedupe −0.014 to +0.425, nudges used 0-2 %); small closed vocabularies (8 table types and 15 roles, 97.2 % of hand mapping); SFT on own verified rollouts (+0.073). Cut: rule retrieval (recall@6 0.20-0.26); small-model checker (AUROC 0.40/0.49); first fine-tuned CodeAct (0.346); free T4 training (450-535 s/step); views rewritten every run (−13 points); epochs past 3. Unknown: private score; fixes built on one public shop; held-out train shops; unseen industries (0.571 vs 0.845); harness vs weights; my labels vs official gold.](./figures/11_keep_cut.png)

## 1. What I would keep

### 1.1 Build the clean layer before choosing the model

On November 2 I asked eight models to answer 100 questions from the raw files. Qwen3-14B got 15 right; a 32B model, over the 15B size limit, got 25. Then I gave the models a hand-built clean layer, where the tables were already deduplicated, typed and named. Qwen3-14B went to 62. A model more than twice the size added 10 questions; cleaning the input added 47.

The same thing held later. On November 13, one 1,000-question run with views on scored 0.579 (760 right, 181 wrong, 59 abstain); the same run with views off scored 0.173 (557 / 384 / 59). The model, prompt and loop were the same. The 203 extra right answers came from the data layer alone.

The rule I would keep: before comparing models or training anything, measure the ceiling with a perfect input. If a 14B model with clean tables beats a 32B model with raw ones by 37 questions, the next week belongs to the tables.

### 1.2 Make abstain a policy, not an accident

PA punishes a wrong answer as much as it rewards a right one. My first full run had 566 wrong answers, most given with full confidence, and scored −0.487. Skipping every question would have scored 0.

The vote is where abstain became useful. On the base model, a vote over samples gained +0.117 over one greedy sample. Taking the most common answer explained +0.047; abstaining when the samples did not agree explained +0.070, more than half. The adaptive vote (Part 9) used 2.40 samples per question on average in the b64 run (2.31 in the n2 traces), and the verifier abstains on low agreement, on answers that appear only in the final turn, and on names that do not exist in the shop.

What I tried and dropped: a small model as an answer checker. Its "is this right?" score had an AUROC of 0.40 and 0.49 on two tests, where 0.5 is a coin. A 4B checker turned a 100-question run from 0.22 into 0.06. Agreement between samples of the main model was the only confidence signal that worked.

### 1.3 Measure paired, and twice

Two runs of the same greedy setup changed about 13 % of answers. One 1,000-question run is good to about ±0.025, and 100 questions to about ±0.075. Twenty-question smoke tests swung by ±0.2 and misled me more than once: in one, adding worked examples looked harmful, yet the final system used them.

The fix is to compare question by question. Between v3-main and n2 (Part 10), 50 questions became right and 20 right answers were lost; the paired SE was 0.0135, so +0.050 was clearly real. Between n2 and n3 the total fell 0.012, but the paired SE was 0.010, and the split showed a real +7 from the new policy hidden under noise. Without pairing I would have reverted a fix that worked.

And measure twice before trusting a number you will submit: the n4 image scored 0.924 and 0.931 on two runs of the exact scoring command.

### 1.4 Put fixes in the data, not in the prompt

On November 14 I checked how often the model acted on notes I added to its prompt or to tool outputs ("remember to exclude cancelled orders"). The answer: 0-2 % of the time. A helper function for debts, `debt_at`, was called 0 times on 29 debt questions.

What worked was changing what the model sees. On 355 held-out questions, removing duplicated order lines in the loader, with the model's code unchanged, moved PA from −0.014 to +0.425 (SE 0.036). Most of the n1-n6 fixes in Part 10 follow the same pattern: compute the right column, the right date window or the right join in code, and hand the model a table where the right answer is the easy one.

### 1.5 Cache what the model writes

Some shop views are written by the model itself, for tables my code cannot map. In the n3 run they were rewritten from scratch and kept only in memory; on one shop the new view reversed a column order. The rewritten views cost 13 points net across shops (two shops lost 7 each), more than the gain of the fix I was testing. A view the model writes once, checks against the data, and saves with the shop is a fix; a view it writes again on every run is a source of noise. I proposed caching validated views per shop, but only after the deadline.

### 1.6 Keep vocabularies small and closed

The shop mapper labels every table with a type and every column with a role. My first design had 24 table types and 50 roles; on November 10 I cut it to 8 types and 15 roles. With the smaller set, a code-only draft matched my hand mapping on 385 of 396 roles (97.2 %) and 119 of 121 table types, on 25 train shops it had not seen as examples. A small closed list is easier for the model to fill and easier for code to check.

## 2. What I would cut

| idea | what I measured | why I cut it |
|---|---|---|
| retrieve rules for each question | recall@6 0.20 (embedder), 0.25 (BM25), 0.26 (hybrid) | the whole rulebook fits in about 5k tokens; a fine-tuned embedder got worse (0.145 to 0.091) |
| small-model answer checker | AUROC 0.40 / 0.49 | no signal |
| first fine-tuned CodeAct (ca1) | 0.346 | below the one-shot vote (0.476) |
| training on free T4 GPUs | 450-535 s per step on one GPU | an H100 was about 30x faster |
| model-written views on every run | −13 points between n2 and n3 | noise; cache instead |
| epochs past 3 | validation loss rose after epoch 2; epochs 4-7 scored 0.771-0.795 | no gain |

Retrieval is the one I would warn others about. Each question needed about 4.9 rules on average; with the 6 best matches, a retriever found only a quarter of them. Putting all of it in the prompt was cheaper than any retriever I could train in time.

## 3. What I still do not know

**Did the harness overfit the public set?** Many final-day fixes were found by reading public errors, and several fire mainly on one public shop. I did not measure n2 to n6 on held-out train shops or on my 110 validation questions.

**How much do new industries cost?** On the three public shops from industries with no train shop, the b64 vote scored 0.571, against 0.845 on the rest; those three shops held 36 % of my lost points. The private set has new shop types.

**Harness or weights?** The harness added about 0.14 to the shipped model; SFT added about 0.04 to 0.07. But the two are not independent: the training rollouts came from an older harness, and I have no run of the base model inside the n6 harness.

**How good are my labels?** Every public number in this series uses labels I made myself, with model help. Where my labels are wrong, my "fixes" may be fitting my mistakes.

## 4. What I will check when the private score arrives

1. **The gap.** If private PA is close to the public 0.942, the layer generalised. A drop of 0.1 or more would point at the one-shop fixes and new industries.
2. **Abstain rate.** On public, n6 abstained on 20 of 1,000. On new shop types I expect more; a rate far above the public one could mean that views failed to build, not that the model was careful.
3. **Re-run gap.** The organisers re-run the image; my two runs differed by 0.007, against an allowed 0.03.
4. **Per-type scores, if released.** If unanswerable or list answers drop much more than numbers, the training data (3.5 % unanswerable) is the first suspect.

## Limits

- All numbers are public-set numbers on my own labels; the private score is unknown when this was written.
- Several lessons rest on one comparison each (views off, dedupe, the checker), not on repeated runs.
- The 15-to-62 result used a hand-built layer on 100 questions; it measures a ceiling, not a system I shipped.
- The harness-versus-weights split is not a controlled experiment.

## Reproduce

Each lesson comes from runs described in Parts 2 to 10: 100-question model ceilings on single GPUs, 1,000-question public runs of a 9B model with vLLM on L40S, H100 and H200 GPUs (15 to 60 minutes each), and paired comparisons over per-question scores. No new runs were made for this post.

## Sources

- Wang et al., "Self-Consistency Improves Chain of Thought Reasoning in Language Models", ICLR 2023.
- Kadavath et al., "Language Models (Mostly) Know What They Know", 2022 (self-evaluation and calibration).
- Miller, "Adding Error Bars to Evals: A Statistical Approach to Language Model Evaluations", 2024.
- My runs, November 2026: 100-question ceiling and clean-layer runs, views on/off runs, vote and abstain analyses, checker tests, rule-retrieval tests, shop-mapping checks against hand mappings, the n1-n6 paired comparisons, and the public-run ledger.

Written with Claude Code. Numbers checked against the runs under Sources.
