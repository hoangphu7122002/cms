---
title: "The last 48 hours: six harness versions took the same model from 0.869 to 0.942"
description: "On the final day I froze the weights and shipped six harness versions; PA on 1,000 public questions rose from 0.869 to 0.942, one step fell by 0.012, and I learned to read flips, not totals."
pubDatetime: 2026-11-17T00:00:00Z
kind: fieldnote
series: datamate
part: 10
project: datamate
draft: false
tags: [evaluation, benchmarking, fine-tuning]
---

The third training epoch finished at 00:14 on November 16, and I froze the weights. Everything after that was the harness: the code around the model that reads shops, parses questions, runs the loop and checks answers. In the last day I built six versions, n1 to n6, ran each on all 1,000 public questions, and submitted two of them. This is the log of that day, including the step that went down.

## Key results

- The same ep3 model went from **0.869** (main-line harness) to **0.942** (n6) on the 1,000 public questions; with the harness of two days earlier it scored **0.804**.
- The biggest jump, v3-main to n2, was **+0.050** (paired SE 0.0135): **50 questions became right, 20 right answers were lost**.
- n3 added a policy that helped its 20 target questions by **+7 points** but lost **0.012** overall, which was within noise (SE 0.010): sampling noise cost about 9 points and model-written views about 13.
- I submitted **n4 (0.926)** first and **n6 (0.942)** last; only the last one counts.
- Many fixes were found by reading public errors, and several fire mainly on one public shop. **The public gains may not transfer to the private set.**

All scores here are PA on the 1,000 public questions with my own labels: the organisers did not release public gold. PA = (correct − wrong) / n; an abstain (skipped question) scores 0. The private score is unknown when this was written.

## 1. The rules for the day

With one day left and one model, I set three rules.

**Every fix behind a flag.** A fix is a small piece of code (for example, "money in this shop's order table equals quantity times price; check it") that is off by default and turned on in a config. If a version went down, I could switch flags off one by one.

**Every fix tested on odd files.** Each fix had unit tests with Vietnamese headers without accents, English headers, empty (NaN) cells and columns in a different order. Before a full run I swept all 44 shops (30 train and 14 public) through the shop-reading code: 0 exceptions.

**Every comparison paired.** Two runs on the same 1,000 questions are compared question by question, not by total. The paired standard error (SE) is computed from the per-question differences, and it is much smaller than the SE of one run (about 0.010 against 0.011-0.017 here), because most questions do not change.

## 2. The ladder

![PA with ±1 SE on 1,000 public questions: ep3 with the old harness 0.804 (871/67/62), v3-main 0.869, n1 0.888, n2 0.919, n3 0.907 (red), n4 0.926 (submission 1), n5 0.939, n6 0.942 (submission 2, final); n4 image re-runs 0.924 and 0.931; v3-main to n2 paired +0.050 (SE 0.0135); n3 −0.012 (SE 0.010); n6 vs n5 +0.003 (SE 0.009).](./figures/10_ladder.png)

| version | what changed | right / wrong / abstain | PA | paired vs previous |
|---|---|---|---|---|
| ep3, old harness | starting point | 871 / 67 / 62 | 0.804 | |
| v3-main | main-line harness, with a fix commit | 914 / 45 / 41 | 0.869 | |
| n1 | first fix batch | 922 / 34 / 44 | 0.888 | +0.019 (SE 0.0119) |
| n2 | about 20 new flags | 944 / 25 / 31 | 0.919 | +0.031 (SE 0.0114) |
| n3 | n2 + as-of view policy | 940 / 33 / 27 | 0.907 | −0.012 (SE 0.010) |
| n4 | n3 + 5 model-error guards | 954 / 28 / 18 | 0.926 | submitted first |
| n5 | n4 + 4 flags | 959 / 20 / 21 | 0.939 | |
| n6 | n5 + 4 flags | 961 / 19 / 20 | 0.942 | +0.003 vs n5 (SE 0.009) |

v3-main needed two tries. The first run abstained on all 1,000 questions: a worked-example bank file was missing from the code, and list cells crashed the value scans. After a fix commit, the rerun gave 0.869 in 48 minutes on 2x H200.

Wrong answers fell from 45 to 19 between v3-main and n6, and abstains fell from 41 to 20. Wrong answers matter more: each one costs a full point, while an abstain costs nothing.

## 3. n1 and n2: what moved

The n2 fixes were mostly about reading the shop right, not about the model. They came from a line-by-line review of public errors, checked against the code. A few, in plain words:

- **Staff key**: in a repair-shop book, find the person column by its header, with the id column as a fallback.
- **Order money**: in one shop type the "customer paid" column already has discounts and trade-ins removed, so the model must not subtract them again; the data itself proves the identity.
- **Time windows**: "N days since the price change against the N days before" and "this month so far against the same days last month" become exact date pairs in code; several months named without a year become a month list.
- **Weekdays and shifts**: "on Sundays" and "the morning shift" become filters on day of week and hour, written on a card the model reads.
- **Particles**: Vietnamese sentence-final particles are removed before matching names.
- **Item kinds**: a service fee on a sales line is not an item sold.

### 3.1 Reading the flips

![Where the points moved. (a) v3-main to n2: wrong to right +56 (28 questions), abstain to right +22, wrong to abstain +3, abstain to wrong −3, right to abstain −12, right to wrong −16 (8 questions), net +50 points = +0.050. (b) n2 to n3: as-of policy +7, sampling and vote noise −9, model-written views −13, rest +3, net −12.](./figures/10_flips.png)

A total hides what happened. Between v3-main and n2, 50 questions became right and 20 right answers were lost (panel a); another 3 went from wrong to abstain and 3 from abstain to wrong. The gains were real wins: 28 questions went from wrong to right, worth 2 points each, and 22 from abstain to right. The losses were mostly safe ones: 12 right answers became abstains (−1 each). Only 8 went from right to wrong.

The flip count tells me more than the total. A fix that adds 50 and loses 20 is a fix plus noise; a fix that adds 10 and loses 10 is just noise. On one public shop (installment sales with customer debt), PA went from 0.381 to 0.635 between v3-main and n2.

## 4. n3: a real fix hidden by noise

n3 added one policy on top of n2. When a question has an `as_of_date`, the shop tables should be cut to rows dated on or before it. For most tables that is easy. For installment contracts it is not: a contract signed long ago can still be open, and the old code, which cut contracts by their last payment date, dropped 191 of 235 contracts on one test date. The policy lets each view declare how to cut: contracts by purchase date, payment schedules never dropped, running totals recomputed from dated payments.

The total fell from 0.919 to 0.907. My first reading was "the policy is wrong". The paired analysis said otherwise (panel b):

| part of the run | questions | points |
|---|---|---|
| questions the policy touched (all on one shop) | 20 | +7 (PA 0.100 → 0.450) |
| same-prompt questions that changed anyway | of 480 identical prompts, 21 changed | −9 |
| model-written views, rewritten each run | net over all shops | −13 |
| rest | – | +3 (derived) |
| **total** | 1,000 | **−12** |

The policy did its job: 7 questions better, 3 worse, all on the shop it was built for. The loss came from two places the policy never touched. First, 21 of 480 questions with exactly the same prompt changed answer, because the run moved to a different GPU type (two L40S instead of one H200) and GPU arithmetic is not repeatable across hardware (Part 9). Second, some shop views are written by the model, and they were rewritten in this run and kept only in memory; on one shop the new view reversed a column order. The two worst shops each lost 7 points in total; across all shops the rewritten views cost 13 points net.

The paired difference was −0.012 with SE 0.010, z −1.18: not a real drop. The fix for the second problem, caching validated views per shop inside the image, came after the deadline.

## 5. n4 to n6 and the two submissions

I had 2 submission slots, and only the last submission counts. I submitted n4 first as a safe fallback: its image had been run twice with the exact scoring command (0.924 and 0.931, Part 9). Code-only changes after that were built as a thin layer on top of the n4 image in about 2 minutes, so n5 and n6 did not need a full rebuild.

n4 kept the n3 policy and added five guards for model errors I had classified in the n3 run. Two are notes from the kernel: one when the code sums sales without the rulebook's "counts as revenue" filter, one when it filters on dates outside the question's window. One is an answer check that warns when a ranked list comes back in another order. Two go into the question profile: "no column for this product group, so answer cannot-answer", and the one column whose values hold a phrase from the question. n5 added four flags (as-of cuts that follow key columns, headers written as one glued word, a rounding check, a week anchor). n6 added four more: plurality on low-share votes, a check that counts items without service lines, a reminder when a yes/no answer comes back for a question with no yes/no word, and a check for windows one day too long.

n6 against n5: 23 questions better, 19 worse, +0.003 (SE 0.009). That is noise, and I knew it when I chose n6. Against the two runs of the n4 image it was +27/−17 and +24/−18. n6 ran in 31 minutes on the final image and was submitted as the final entry. Status when this was written: the final entry is in, and the private score is not out.

## 6. What I did not measure

Every fix in this post was chosen by reading public errors and checked against my own public labels. Several fire mainly on one public shop: the installment and debt rules on one, a repair-shop rule on another, the order-money check on four. I did not run n2 to n6 on the held-out train shops or on my 110 validation questions. The private set has about 500 questions from new shop types. Some of these rules will not fire there; some may fire wrongly.

## Limits

- All numbers use my own labels on the public set; label errors move every version the same way, but not equally.
- n3 ran on two L40S, the others mostly on H200; part of every difference is hardware noise.
- The SE for ep3-old-harness, n4, n5 and n6 is computed from the counts, not from my paired files.
- The "+3 rest" in the n3 split is derived from the other three numbers.
- No held-out measurement after n1, so the size of public overfitting is unknown.

## Reproduce

Each version was a full 1,000-question public run of the same merged 9B model with the adaptive vote (up to 5 samples) and 3 worked examples in the prompt: about 33-35 minutes on one H200, about 1 hour on two L40S. Paired comparisons used per-question scores in {+1, 0, −1} and the standard error of their differences. The final images ran with the exact offline scoring command on two H200 GPUs in 30 to 31 minutes.

## Sources

- Dror et al., "The Hitchhiker's Guide to Testing Statistical Significance in Natural Language Processing", ACL 2018.
- Miller, "Adding Error Bars to Evals: A Statistical Approach to Language Model Evaluations", 2024 (paired standard errors).
- My runs, November 2026: public evaluations of v3-main and n1 to n6, the paired comparison files and analysis notes for n1/n2 and n2/n3, two re-runs of the n4 image, the submission checklist.

Written with Claude Code. Numbers checked against the runs under Sources.
