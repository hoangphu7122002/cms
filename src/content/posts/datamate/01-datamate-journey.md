---
title: "From -0.49 to 0.94: the DataMate journey in one page"
description: "In 15 days my 9B system went from losing 0.487 points per question to scoring 0.942 on 1,000 public questions over messy shop files, and most of the climb came from the data layer, not the weights."
pubDatetime: 2026-11-17T00:00:00Z
kind: series
series: datamate
part: 1
project: datamate
draft: false
tags: [datamate, table-qa, vietnamese, agents, codeact, sft, zalo-ai-challenge]
---

Small Vietnamese shops keep their books in whatever file is at hand: a CSV, an Excel workbook with one sheet per month, a SQLite file. The DataMate track asks a model to answer casual Vietnamese questions about those files, such as "how much did we sell last week, not counting cancelled orders?". My first full run on November 2 scored -0.487. My final run on November 16 scored 0.942. This post is the map of that climb; the posts after it zoom into each step.

## Key results

- PA, the score (defined in Section 2), went from **-0.487** (79 right, 566 wrong, 355 abstain) to **0.942** (961 right, 19 wrong, 20 abstain) on the 1,000 public questions, scored with my own labels.
- A hand-built clean data layer lifted Qwen3-14B from **15 to 62** correct out of 100 questions; going from 14B to a 32B model without the layer lifted it only from 15 to 25.
- The step from one-shot code to a multi-turn CodeAct loop, then a vote over samples, took me from **0.403** (a LoRA-trained one-shot coder) to **0.725** with the untrained base model.
- Fine-tuning (SFT with LoRA) on train-shop trajectories added about **+0.04 to +0.07**; on the last day, a new harness and three batches of fixes took the same fine-tuned model from **0.804 to 0.942**.
- The private test (about 500 questions, new shop types) is scored by the organisers; **I do not know that score yet**.

## 1. The task

### 1.1 What a question looks like

Each question comes with a shop folder, an `as_of_date` ("this month" means the month of that date), a shared rulebook of business definitions, and a calendar with solar and lunar dates. An invented example in the same spirit: *"Tháng này quán bán được bao nhiêu ly bạc xỉu?"* (How many cups of iced milk coffee did we sell this month?). To answer, the system must find the sales table, drop cancelled orders as the rulebook defines them, match "bạc xỉu" to the item names in the file, and sum the right quantity column.

The answer has a type: number, percent, string, list, date, boolean, table, or `unanswerable` when the files cannot answer it. Matching is strict: money must be exact, percents to 2 decimals, and the right value in the wrong format counts as wrong.

### 1.2 The data

| split | shops | questions | answers given? |
|---|---|---|---|
| train | 30 | 3,000 | yes |
| public test | 14 | 1,000 | no |
| private test | unseen | about 500 | no, new shop types |

The public shops add business types that train does not have (phone shops, motorbike repair, mother-and-baby stores), and the public rulebook differs from the train one (24 KB against 18 KB, new rules, 3 old rules gone). The files are dirty on purpose: duplicated detail rows, total rows inside the data, money written as "1tr2" or "38.5k", three or four date formats in one shop. Part 2 is about that mess.

### 1.3 The constraints

All models together must stay at or under 15B parameters, with open weights published before October 1, 2026. The solution ships as an offline Docker image that must answer the private set within 6 hours on two RTX 5090 GPUs. Test data may not be used for training. If the organisers' re-run differs from my submitted score by more than 0.03, the result can be reviewed.

## 2. The score, and why skipping matters

PA counts +1 for a right answer, -1 for a wrong one and 0 for an abstain (a skipped question): **PA = (right - wrong) / n**. A system that skips every question scores exactly 0.

![Panel (a): right +1, abstain 0, wrong -1. Panel (b): expected points per answered question is 2p - 1, so answering pays only above 50% accuracy; my Nov 2 run answered 645 questions at 12.2% accuracy, code3 on Nov 11 answered 841 at 74.0%, the final n6 answered 980 at 98.1%.](./figures/01_scoring.png)

The rule has a sharp consequence. If a system is right with probability p on the questions it answers, each answer is worth 2p - 1 on average, so answering pays only when p > 0.5. My first full run answered 645 questions and got 79 right (12.2%): every answer cost me on average 0.76 points. A thought experiment on November 2 made this concrete: if Qwen3-14B had answered only the questions it got right, its PA on 100 questions would move from -0.36 to +0.15. Knowing when to abstain was as important as being right.

**About my numbers.** The organisers did not release answers for the public set. On November 2 I labelled all 1,000 public questions myself with Claude Sonnet agents and had Claude Opus review the 68 uncertain ones. On train shops the same process got 153 of 153 high-confidence labels right, so I estimate about 99% label accuracy. Every public PA in this series is scored against these labels of mine, not official gold. One run on 1,000 questions has a standard error (SE) of about 0.01 to 0.03, so gaps under about 0.02 are noise.

## 3. Fifteen days in one chart

![PA on 1,000 public questions for 22 runs from Nov 2 to Nov 16, in six stages: layer and catalogue (-0.487, 0.168, 0.330), restart with raw prompt (-0.415, 0.171, 0.289), trained one-shot code (0.403, 0.476), CodeAct loop (0.346, 0.579, 0.635, 0.725), SFT (0.767, 0.798, 0.804), harness batches (ep3 on the new harness 0.869, up to 0.942, with a dip to 0.907 at n3).](./figures/01_pa_ladder.png)

The line is not a staircase. It drops three times, and each drop taught me something.

### 3.1 Nov 2-5: free-form pandas, then a layer (old repo)

Day one: an 8B model wrote pandas code over raw tables, with up to 2 fixes after a crash. It scored -0.487 (Qwen3-8B, 79/566/355). I then tested eight models on the same 100 questions. The best raw model got 25 of 100, and about 60% of the questions were solved by none of four models. Then I built, per public shop and by hand, a clean "oracle" layer with 34 business functions, for diagnosis only. With it, the same models jumped by 23 to 47 correct answers. The bottleneck was understanding the shop, not model size (Part 3).

I turned that into a real pipeline: a role config per shop (which column is the order code, the amount, the status), a generic table builder, and an automatic mapper. It reached PA 0.168 on November 4 and 0.330 on November 5, with Qwen3.5-9B, the model I kept to the end.

### 3.2 Nov 5-8: the restart and its drop

On November 5 I started a new codebase and dropped the mapper and catalogue: I thought a fixed function list capped what the model could do. The first runs with the whole rulebook in the prompt and no examples were all negative, from -0.415 to -0.468 (Part 2). Two fixes in the data, not the model, made the difference: removing duplicated order lines and a handful of other cleanups. Qwen3.5-9B with an early pandas LoRA adapter (trained on free Kaggle T4s) then reached 0.171 with one sample and 0.289 with a vote of three.

### 3.3 Nov 9-11: training a one-shot coder

I generated training rows on train shops with a teacher model, verified each against the train answers, and trained a LoRA adapter. "code3" (three examples in the prompt) scored 0.403, and 0.476 with a vote of three drafts. Part 4 explains why one shot hit a ceiling: it writes the whole program before it sees a single row.

### 3.4 Nov 11-14: CodeAct, a loop that looks

CodeAct lets the model write a code cell, read the output, and write the next, up to 10 turns. My first trained CodeAct model (ca1) scored lower, 0.346: it printed the right date range, then ignored it. The fix was to stop training for a moment: with native tool calls and the data handed over in clean "views", the untrained base model scored 0.579; with loop fixes 0.635; with a vote of three and abstain on weak agreement, 0.725 (Part 5). Turning views off in the same single-sample setup dropped it to 0.173: the layer had come back (Part 6).

### 3.5 Nov 14-16: SFT, then harness batches

From 6,000 rollouts on train questions plus teacher repairs I built 4,030 training rows and fine-tuned Qwen3.5-9B with LoRA on two H200 GPUs (Part 8). The teachers for this final SFT data were Claude Haiku 5.5 (low reasoning) and DeepSeek 4.1 Flash. With an adaptive vote of 2 to 5 samples, the tuned model scored 0.798, and 0.804 after a third epoch (ep3, a warm restart at learning rate 1e-4). The same ep3 model on the updated harness scored 0.869 (914 / 45 / 41); three more batches of harness fixes took it to 0.942 (Part 10). One batch (n3) dropped to 0.907 because LLM-written views changed from run to run. I submitted n4 first, then n6 as the final image.

## 4. What shipped

One model, Qwen3.5-9B (9.65B parameters) with my LoRA merged in bf16, serves every step: question analysis, the CodeAct solver, checks and the answer formatter. Per shop, code reads the files once and builds views; per question, the model runs at most 10 turns, an adaptive vote draws 2 to 5 samples (2.40 on average in the b64 run, 2.31 in the n2 traces), and any crash or time-out becomes an abstain, never a wrong answer. The image is about 27.6 GB and answered the 1,000 public questions in 30 to 31 minutes on two H200 GPUs, well inside the 6-hour limit (Part 9).

| stage | best public PA | right / wrong / abstain |
|---|---|---|
| free-form pandas, Nov 2 | -0.487 | 79 / 566 / 355 |
| one-shot code + vote, Nov 11 | 0.476 | 586 / 110 / 304 |
| CodeAct, base model, vote, Nov 14 | 0.725 | 809 / 84 / 107 |
| SFT, adaptive vote, Nov 15 | 0.798 | 869 / 71 / 60 |
| final image n6, Nov 16 | 0.942 | 961 / 19 / 20 |

## Limits

- All public numbers use my own labels (about 99% accurate on a train check), not official answers.
- Many fixes of the last week came from reading public-set errors, and several fire on a single public shop. Public gains may not transfer to the private set.
- The chart mixes pipelines and two codebases; each point is one run, and gaps under about 0.02 are noise.
- The private score is unknown at the time of writing.

## Reproduce

I ran about 53 full public evaluations of 1,000 questions over 15 days. Early runs used rented L40S and H100 GPUs and free Kaggle T4s (about 1.3 to 3 USD per 1,000 questions on rented GPUs, 10 to 60 minutes); later runs used a shared 2x L40S box and 2x H200 GPUs. Each run: build the per-shop layer on CPU, serve the model with vLLM, answer all questions, score against my labels with the PA rule above, and compare runs as paired differences with an SE.

## Sources

- Zalo AI Challenge 2026, DataMate track rules and data description (organisers' site and Docker guideline).
- Qwen3.5-9B model card, Hugging Face (Apache-2.0).
- Wang et al., "Executable Code Actions Elicit Better LLM Agents" (CodeAct), https://arxiv.org/abs/2402.01030.
- Yao et al., "ReAct: Synergizing Reasoning and Acting in Language Models", https://arxiv.org/abs/2210.03629.
- My runs, November 2026: 1,000-question public evaluations from v0.2 (Nov 2) to n6 (Nov 16), 100-question model ceiling and oracle-layer runs (Nov 2), my label files and scorer, final Docker inventory.

Written with Claude Code. Numbers checked against the runs under Sources.
