---
title: "Start here: DataMate, from -0.487 to 0.942 in 15 days"
description: "What the DataMate task is, how PA scores it, how one 9B model climbed from -0.487 to 0.942 on 1,000 public questions, and a map of the other thirteen posts."
pubDatetime: 2026-11-17T00:00:00Z
kind: series
series: datamate
part: 0
project: datamate
draft: false
tags: [datamate, table-qa, vietnamese, agents, codeact, sft, zalo-ai-challenge, overview]
---

DataMate asks a model to answer casual Vietnamese questions about the messy books of small shops. In 15 days my system went from -0.487 to 0.942 on the 1,000 public questions, and most of the climb came from the data layer and the harness, not the weights. This post is the whole story on one page, then a map of the other posts.

## Key results

PA on the 1,000 public questions, scored with my own labels (about 99% accurate on a train check; the organisers released no public answers). One run has an SE of about 0.01 to 0.03.

| stage | run | right / wrong / abstain | PA |
|---|---|---|---|
| free-form pandas, Nov 2 | v0.2 | 79 / 566 / 355 | -0.487 |
| trained one-shot code + vote, Nov 11 | code3 vote | 586 / 110 / 304 | 0.476 |
| first fine-tuned CodeAct, Nov 11 | ca1 | 625 / 279 / 96 | 0.346 |
| CodeAct, base model, views, vote of 3, Nov 14 | v4ab | 809 / 84 / 107 | 0.725 |
| SFT, adaptive vote, Nov 15 | b64 | 869 / 71 / 60 | 0.798 |
| final image, Nov 16 | n6 | 961 / 19 / 20 | 0.942 |

![PA on 1,000 public questions for 22 runs from Nov 2 to Nov 16, in six stages: layer and catalogue (-0.487, 0.168, 0.330), restart with raw prompt (-0.415, 0.171, 0.289), trained one-shot code (0.403, 0.476), CodeAct loop (0.346, 0.579, 0.635, 0.725), SFT (0.767, 0.798, 0.804), harness batches (ep3 on the new harness 0.869, up to 0.942, with a dip to 0.907 at n3).](./figures/01_pa_ladder.png)

## 1. The project

Each question comes with a shop folder, an `as_of_date`, a shared rulebook and a calendar. Train has 30 shops and 3,000 questions with answers; public has 14 shops and 1,000 questions; the private test has about 500 questions from new shop types. The files hold duplicated order lines, total rows, money like "1tr2" and mixed date formats. The rules: at most 15B parameters, an offline Docker image, 6 hours on two RTX 5090 cards, no test data in training, and an organiser re-run within 0.03 of my score.

The score is **PA = (right - wrong) / n**: +1 right, -1 wrong, 0 for an abstain. Skipping everything scores 0, and answering pays only above 50% accuracy. My first full run answered 645 questions at 12.2% accuracy. Knowing when to abstain mattered as much as being right.

## 2. The question and the approach

Can a 9B model read messy shop files well enough to beat skipping everything, and then get close to perfect? Four steps got me there.

**Clean the data first.** On 100 questions, a hand-built clean layer lifted Qwen3-14B from 15 to 62 correct; a 32B model on raw files reached 25. With raw tables in the prompt, four baselines scored -0.415 to -0.468, below skipping. One dedupe rule, with the model's code unchanged, moved 355 held-out train questions from -0.014 to +0.425.

**One shot, then a loop.** A LoRA-trained one-shot coder (code3) scored 0.403, and 0.476 with a vote of three. It wrote the whole program before seeing a row. A ReAct harness (one named tool per turn) on the untrained base model showed that a 9B model can run a loop when the data arrives clean; I ported pieces of it. My first CodeAct loop (ca1, fine-tuned) scored 0.346: it printed the right period, then ignored it. With native tool calls and clean views, the untrained base model scored 0.579, then 0.635 with loop fixes, then 0.725 with a vote of three and abstain on weak agreement.

**The layer adaptation harness.** The solver stays generic; each shop gets an adapter built mostly by code. A loader cleans the files, a code draft gives each table one of 8 types and each column one of 15 roles, checks test the draft on the data, and a failing table is dropped, never the shop. The result is clean views (`sales_lines`, `orders`, ...) with rules like `counts_as_revenue` applied once. The draft matched my hand mappings on 385 of 396 roles. Turning views off dropped the solver from 0.579 to 0.173.

**Train on its own correct answers.** From train shops only I built 4,030 rows: 2,546 of the base model's rollouts that reached gold, and 1,484 teacher repairs of its failures, by Claude Haiku 5.5 (low reasoning) and DeepSeek 4.1 Flash. LoRA SFT on 2x H200 lifted the vote from 0.725 to 0.798. A third epoch (ep3, 0.804) is the model I shipped.

## 3. The system in one paragraph

One merged Qwen3.5-9B does every model step, one vLLM server per GPU. A shop is read once into views; a question gets code for text, time window and names, plus one analysis call; a CodeAct loop runs Python in a persistent kernel for at most 10 turns; an adaptive vote draws 2 to 5 samples; code rules turn weak answers into abstains; a formatter writes the official shape. Of 19 steps, 5 call the model, about 10.2 calls per question (n2 traces). The model may propose; code decides. The output file starts as 1,000 abstains, so a crash costs only unfinished questions.

## 4. What the numbers say

- **Abstain is a policy.** A vote gained +0.117 over one greedy sample; +0.070 of that came from abstaining when samples disagreed.
- **The harness did more than training.** SFT moved the vote from 0.725 to 0.798. On the last day six harness versions took the same ep3 model from 0.869 to 0.942 (0.804 on the older harness). One batch, n3, dipped to 0.907 because model-written views changed between runs.
- **The 6-hour box was roomy.** The final image answered 1,000 questions in 31 minutes on 2x H200. In the b64 run the adaptive vote used 2.40 samples per question on average. Two re-runs of the n4 image scored 0.924 and 0.931, inside the 0.03 rule.
- **Noise is real.** About 13% of answers change between identical runs, so I compared runs question by question.
- **Keep:** the clean layer first, abstain on purpose, paired tests, fixes in the data (notes in the prompt were acted on 0-2% of the time), small vocabularies. **Cut:** rule retrieval, a small-model checker (AUROC 0.40 and 0.49), views rewritten every run, epochs past 3.

## 5. Reader's map

The whole climb:
- [From -0.49 to 0.94: the DataMate journey in one page](/posts/datamate/01-datamate-journey/)
- [The last 48 hours: six harness versions took the same model from 0.869 to 0.942](/posts/datamate/10-the-last-48-hours/)

Data and the layer:
- [Messy shops: when reading the files was the model's job](/posts/datamate/02-messy-shops/)
- [A clean layer beats a bigger model](/posts/datamate/03-clean-layer/)
- [The layer adaptation harness: keep the solver generic, adapt the shop](/posts/datamate/06-layer-adaptation-harness/)

The solver:
- [One-shot code and votes: 0.403 to 0.496 without looking at the data](/posts/datamate/04-one-shot-code-and-votes/)
- [ReAct, then CodeAct: letting the model look at the data before it answers](/posts/datamate/05-react-then-codeact/)

Training and serving:
- [Training a 9B student on its own correct answers added 0.07 PA](/posts/datamate/08-training-a-9b-student/)
- [Inside a 6-hour box, my 1,000-question run took 31 minutes](/posts/datamate/09-inference-inside-a-6-hour-box/)

Architecture:
- [One 9B model, four layers, about ten calls per question: the DataMate architecture](/posts/datamate/12-whole-system-architecture/)
- [Inside the modules: every model step in DataMate has a code fallback](/posts/datamate/13-inside-the-modules/)

Lessons:
- [Ideas I tried that did not ship, and what the numbers said](/posts/datamate/07-ideas-that-did-not-ship/)
- [What I would keep, what I would cut: a clean data layer beat a bigger model](/posts/datamate/11-what-we-would-keep/)

Suggested order: Part 1, then Part 3, then Part 6.

## Limits

- Every public number uses my own labels, not official answers.
- Many final-day fixes came from public errors; several fire on one public shop and may not transfer.
- Shops from industries with no train shop were my weakest group: 0.571 against 0.845 on the rest (b64 vote).
- The private score is unknown at the time of writing.

## Reproduce

Build the per-shop layer on CPU, serve the model with vLLM, answer all 1,000 public questions, score with the PA rule, and compare runs as paired differences. Parts 1 to 13 give the details.

## Sources

- Zalo AI Challenge 2026, DataMate track rules; Qwen3.5-9B model card (Apache-2.0).
- CodeAct: https://arxiv.org/abs/2402.01030; ReAct: https://arxiv.org/abs/2210.03629.
- My runs, November 2026, as cited in Parts 1 to 13.

Written with Claude Code. Numbers checked against the runs under Sources.
