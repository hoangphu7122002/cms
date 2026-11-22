---
title: "Inside a 6-hour box, my 1,000-question run took 31 minutes"
description: "The final Docker image answered 1,000 public questions in 31 minutes on 2x H200 under a 6-hour limit, using an adaptive vote of 2 to 5 samples per question (2.40 on average in the b64 run) and abstaining whenever something broke."
pubDatetime: 2026-11-17T00:00:00Z
kind: series
series: datamate
part: 9
project: datamate
draft: false
tags: [llm-serving, vllm, modal, benchmarking, self-consistency]
---

The organisers do not call an API: they load my Docker image on their machine with no network, mount the data read-only, and give it 6 hours. Whatever is in `submission.jsonl` at the end is scored. So the inference system had two jobs: answer well, and never leave the file broken. This post walks one question through that system, then the time budget and the run-to-run noise I could not remove.

## Key results

- The final image answered 1,000 public questions in **31 minutes** on 2x H200; the hard limit is **360 minutes**.
- An adaptive vote used **2.40 samples per question** on average (849 questions stopped at 2), **20 % fewer** than a fixed vote of 3, and scored **0.798** with the b64 model.
- Two re-runs of the same image scored **0.924** and **0.931**, a gap of **0.007**; the organisers' rule allows **0.03** between my score and theirs.
- With identical prompts, the first greedy sample differed on **12.5 %** of questions between an H200 and an L40S; about **13 %** of answers can change from one run to the next.
- The output file starts as 1,000 abstains and is rewritten atomically, so a crash or timeout costs only the unfinished questions.

Public scores are PA on the 1,000 public questions with my own labels (the organisers did not release public gold). PA = (correct − wrong) / n; abstaining scores 0. The private score is not known yet.

## 1. The contract

The scoring command is fixed: `docker run` with two GPUs, `--network none`, the data folder mounted read-only at `/data`, an output folder at `/result`, and my entry script `/code/predict.sh`. The organisers' machine has two RTX 5090 cards (32 GB each, driver 570) per the task rules. Inside, the rules I set myself:

- **One model for everything.** The same merged Qwen3.5-9B (SFT ep3, Part 8) does question analysis, view writing, solving, checks and answer formatting. No second model, no external call.
- **One vLLM server per GPU**, bf16 weights, 32,768-token context, prefix caching on (the shared prompt prefix, rulebook plus shop views, is computed once and reused), 90 % of GPU memory, up to 24 sequences per server, seed 0, thinking mode off. 32 questions are in flight at once.
- **A safe output file.** Before any model loads, `submission.jsonl` is written with all 1,000 rows set to abstain. Each finished answer rewrites the file atomically (write a temp file, then rename), so the file is always valid JSON lines.

The image was 27.6 GB compressed (27,605,261,202 bytes), of which the weights are about 19 GB. The application runs in its own Python environment, separate from vLLM's, so a library update on one side cannot break the other.

## 2. One question, step by step

![Request flow: shop files are read once into clean views; each question gets text normalisation, time and entity parsing and one analysis call, then a CodeAct loop of at most 10 turns with a Python kernel (one process per sample, at most 32 at once, 30 s per cell), an adaptive vote of 2 to 5 samples (mean 2.40 in the b64 run), checks and a formatter, then submission.jsonl; any crash or timeout exits to abstain, which scores 0.](./figures/09_request_flow.png)

### 2.1 Shop first, once

Each shop folder is read once, before its questions start. Code loaders clean the files (duplicated lines, total rows, money like "1tr2", mixed date formats; Part 2) and write views: clean tables with fixed column roles. If the mapping check fails for one table, that table is left out of the views and the raw table stays; the shop is never dropped as a whole.

### 2.2 Read the question

Before the model sees the question, plain code normalises the text (Vietnamese with or without accents, slang for money), resolves time phrases against the question's `as_of_date` ("last week", "this lunar month"), and matches names to entities in the shop. Then one model call writes a short analysis: the expected answer type and what the question is about.

### 2.3 Solve with code

The solver is a CodeAct loop (Part 5): the model writes Python, a persistent kernel runs it on the views, the model reads the output and writes the next cell, up to 10 turns. Each sample gets its own spawned kernel process, at most 32 at once, with a 30-second limit per cell; a separate pool of 16 sandbox workers serves the cached shop tables. Each request has a fixed sampling seed made from the question id, the sample number and the turn, so the same question asks for the same random draws on every run. Generation is capped at 3,072 new tokens per turn.

### 2.4 Vote, but only when needed

![Adaptive vote: sample 1 at temperature 0 and sample 2 at 0.3; if the two answers agree, keep it (849 questions); otherwise add samples 3 and 4 and keep an answer 3 of 4 agree on (56 questions); otherwise add sample 5 (95 questions), take the most common answer, and the verifier abstains when its share is low. Mean 2.40 samples, PA 0.798 (869 right, 71 wrong, 60 abstain).](./figures/09_adaptive_vote.png)

A vote draws several answers and keeps the most common one. A fixed vote of 3 costs 3 full CodeAct runs per question. Most questions do not need that: if a greedy sample and a sample at temperature 0.3 already agree, a third rarely changes anything. So the adaptive vote starts with 2, and adds samples only on disagreement, up to 5. Money is normalised to dong and names are normalised before answers are compared, so "1,2 triệu" and "1200000" count as the same answer.

On the b64 model, 849 questions stopped at 2 samples, 56 at 4 and 95 at 5: a mean of 2.40, 20 % less work than a fixed vote of 3. It scored 0.798 (869 right, 71 wrong, 60 abstain).

### 2.5 Check, then format

A first check (tier 1) asks the model to review the answer and allows at most one repair round; it may fix a value but cannot change the answer's type. I kept it for safety, but measured no gain: in one 1,000-question run of the shipped model it made 5 repairs (1 wrong to right, 2 right to wrong, 2 wrong to abstain), net 0, and a second model check on the format (tier 2) ran 913 times and changed nothing. Then a verifier made of plain rules abstains in three cases: the winning answer has a low share of the votes, the answer appears only in the final turn, or it names an entity that does not exist in the shop. Last, a formatter turns the answer into the exact form the organisers' answer types require (for example, percents to 2 decimals).

Every failure path ends the same way. A Python error, a timeout or a malformed answer leaves that row as abstain: 0 points, not −1.

## 3. The time budget

![Wall time of full 1,000-question runs: the final image n6 took 31 minutes on 2x H200; two re-runs of the n4 image took 30 and 31 minutes; harness n3 on 2x L40S (one GPU shared) took about 1 hour; the early estimate for about 500 private questions on 2x RTX 5090 was 30-60 minutes, worst about 80. The run stops answering at 6 h minus 300 s; 324 minutes stay unused.](./figures/09_time_budget.png)

The run has a budget of 21,600 s with a 300-second safety margin: at 5 h 55 min it stops starting new work and keeps every saved answer. I never came close. The final image took 31 minutes for 1,000 questions on 2x H200, and the private set has about 500 questions. Before I had any real timing, I estimated 30 to 60 minutes, worst case about 80, for 500 questions on the organisers' two RTX 5090 cards. I never ran on that hardware myself; the image did pass the organisers' test-solution check on November 14.

Two changes made the run fast enough to use a vote at all. First, the adaptive vote (above). Second, a thread fix: the 16 sandbox workers each started with default math-library threads (65 or more each) and fought over the CPU. Limiting each to 2 threads, and raising the workers to 24, took a single-sample evaluation from about 55 to 101 questions per minute, and a vote evaluation running next to it from about 24 to 57, on one shared H200 machine.

Why not spend the unused 5 hours on more samples? Because the tie-break between equal scores is the lower inference time, and because extra samples cannot fix a wrong view: every sample reads the same view.

## 4. Same input, different answers

### 4.1 How big the noise is

I expected seed 0 and fixed per-request seeds to make runs repeatable. They did not:

| test | what changed | result |
|---|---|---|
| same prompts, greedy, H200 vs L40S | GPU type | first sample differs on 12.5 % of questions |
| same greedy config, two runs | nothing | about 13 % of questions change |
| n3 harness, 480 questions with identical prompts | nothing in the prompt | 21 answers changed (4.4 %) |

Greedy decoding still depends on floating-point sums, and their order depends on the GPU, the batch the request lands in, and prefix-cache hits. A small difference in one token can send a CodeAct loop down another path. My working rule: one 1,000-question run is good to about ±0.025.

### 4.2 The re-run rule

The organisers re-run the image, and the gap between their PA and mine must stay under 0.03, or the logs are reviewed. I ran the n4 image twice with the exact scoring command on 2x H200 (each server limited to half the GPU memory):

| run | right / wrong / abstain | PA | time |
|---|---|---|---|
| n4 reference (harness, L40S) | 954 / 28 / 18 | 0.926 | – |
| image, run 1 | 953 / 29 / 18 | 0.924 | 31 min |
| image, run 2 | 956 / 25 / 19 | 0.931 | 30 min |

Run 1 against the reference: 22 questions flipped one way, 21 the other, net −0.002 (paired SE 0.010). Run 1 against run 2: 0.007. Both well inside 0.03, on my labels and my hardware. On a different GPU with a new data set, I cannot promise the same.

## 5. Packaging lessons

- **Test the image, not the code.** The first image test on an L40S answered 0 of 10: the base image shipped a video library built for a newer CUDA, and the import failure surfaced only at run time. After the fix, 10 of 10 in about 632 s including vLLM startup. My check script now fails if zero questions are answered.
- **Look for silent all-abstain.** The first attempts at two late harness versions abstained on all 1,000 questions: one missed the worked-example bank file (and crashed on list cells), one reused a cached run folder. Both produced a valid file, so only the score showed the problem.
- **Plan the upload.** After 3 anonymous downloads of the 27.6 GB file, the file host returned "quota exceeded". I switched to checking the MD5 checksum without downloading.

## Limits

- Public numbers use my own labels; the private score is unknown when this was written.
- Timings are on H200 and L40S; the organisers' machine is not one I could test, so the 30-60 minute estimate is unverified.
- The determinism numbers come from a few paired comparisons, not a full study.
- The 55 to 101 (single sample) and 24 to 57 (vote) questions-per-minute gains were read from one pair of evaluations on a shared machine, a few minutes apart, not on the final image.
- I tested only one vLLM version (v0.32.0, CUDA 12.9) and never on RTX 5090 cards.

## Reproduce

I built the image on vLLM's official v0.32.0 CUDA 12.9 image, with its driver check switched off because the scoring machine runs driver 570, the merged bf16 model and a separate Python environment for the application. Code-only changes were applied as a thin layer on top, which took about 2 minutes to build. A full 1,000-question run with the exact scoring command took 30 to 31 minutes on two H200 GPUs; exporting the compressed image took 23 to 24 minutes.

## Sources

- Kwon et al., "Efficient Memory Management for Large Language Model Serving with PagedAttention" (vLLM), SOSP 2023.
- vLLM documentation: automatic prefix caching, reproducibility and seeds.
- Wang et al., "Self-Consistency Improves Chain of Thought Reasoning in Language Models", ICLR 2023.
- Docker documentation: `docker run --network none`, `docker save`.
- My runs, November 2026: submission README and checklist, runtime config, the adaptive-vote run of the b64 model, two re-runs of the n4 image, the n3 analysis, test-submission logs.

Written with Claude Code. Numbers checked against the runs under Sources.
