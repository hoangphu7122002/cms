---
title: "One-shot code and votes: 0.403 to 0.496 without looking at the data"
description: "A LoRA-trained 9B model that writes one pandas program per question scored PA 0.403 on 1,000 public questions; a vote of three drafts and two value rules lifted it to 0.496, and then it stopped."
pubDatetime: 2026-11-17T00:00:00Z
kind: series
series: datamate
part: 4
project: datamate
draft: false
tags: [datamate, code-generation, lora, sft, self-consistency, abstain]
---

After the data fixes of Part 2, my solver was simple: put the rulebook, a card describing the shop and the question into one prompt, let the model write one pandas program, run it, answer. I trained the model for this, then wrapped it in a repair step and a vote. It reached PA 0.496. This post is about how far that went, and the one thing it could never do: look at the data before it commits.

## Key results

- One-shot code ("code3": Qwen3.5-9B with a LoRA adapter, three examples in the prompt) scored **PA 0.403** on 1,000 public questions: 622 right, 219 wrong, 159 abstain.
- A vote of three drafts (temperatures 0, 0.3, 0.7) gave **0.476**: it dropped 109 wrong answers and gave up 36 right ones.
- Two cheap value rules on top of the vote (zero or empty answer, negative money), replayed on CPU over the stored answers, gave **0.496** (586 / 90 / 324).
- The repair step fixed crashes (50-question check: PA 0.36 to 0.50), but in an earlier check **18 of 22** wrong programs ran without error, so repair never saw them.
- Model checkers did not work: on hard train questions a 4B yes/no checker had AUROC **0.40 and 0.49**, no better than a coin.

## 1. One shot: one prompt, one program

### 1.1 What the model sees

![Flow diagram: a prompt of mean 8,182 tokens (rulebook 54%, shop card 32%, 3 example solutions 8%, tables 5%, question 2%) goes to Qwen3.5-9B with LoRA, which writes a plan and pandas code; a sandbox runs it, value rules check it, and the result is an answer or an abstain. A dashed repair arrow sends crashes and empty results back, at most twice. Notes: repair lifted a 50-question check from PA 0.36 to 0.50; 18 of 22 wrong answers in an earlier check ran without error.](./figures/04_oneshot_flow.png)

On 355 questions the prompt averaged 8,182 tokens, more than half of it rulebook. The model cites only about 6.8 of 87 rules and 2.2 of 9 tables in its plan. I kept the full context anyway, because picking the rules by retrieval had failed (Part 2).

A crash, a timeout or an empty result becomes an abstain (0 points), never a guess (-1).

### 1.2 The first one-shot runs

On November 8 I ran Qwen3.5-9B with an early pandas LoRA adapter (trained on two free Kaggle T4s) on 1,000 public questions. One draft at temperature 0 ("k1") scored 0.171 (509 / 338 / 153), 60.1% accuracy on the questions it answered. Three drafts with a vote ("k3") scored 0.289 (393 / 104 / 503), 79.1% accuracy. But 381 of the 503 abstains were 60-second timeouts, not disagreement: the vote was paying in time, not in doubt.

## 2. Training a one-shot coder

The first adapter had been trained on rows written by a Claude model. For this one-shot phase I decided not to train on Claude outputs and rebuilt the data on train shops only, with DeepSeek 4.1 Flash as the teacher. (That choice held for the one-shot coder only: the final SFT data of Part 8 later used two teachers, Claude Haiku 5.5 with low reasoning and DeepSeek 4.1 Flash.) Its job: write a short 9-slot plan (tables, rulebook section, time window, measure, check, ...) and then pandas code, for 1,635 priority train questions. On a 100-question probe, 89% of its answers matched the train answers. After a repair pass, 1,571 of 1,635 rows (96%) were verified against the official train answers. Only verified rows went into training.

I trained two variants with LoRA (Low-Rank Adaptation: small extra weight matrices, here rank 32, trained on top of the frozen model): **code3**, with three example solutions picked by BM25 in the prompt, and **code0**, with none. Training started in 4-bit on free Kaggle T4 GPUs at 450 to 535 seconds per step, then moved to a rented H100 about 30 times faster.

| check | code3 | code0 |
|---|---|---|
| 50 public questions, no repair | PA 0.36 (24 / 6 / 20) | PA 0.28 |
| 50 public questions, repair up to 2 | PA 0.50 (33 / 8 / 9) | not run |
| 1,000 public questions, repair up to 2 | PA 0.403 (622 / 219 / 159) | not run |

The full code3 run took about 40 minutes on one L40S, about 1.3 USD. Accuracy on answered questions was 74.0%. Like every public number in this series, it is scored with my own labels: the organisers did not release public answers.

## 3. Votes and value rules

### 3.1 The vote

A **vote** asks for several drafts of the same answer and keeps it only if enough of them agree. I drew three drafts at temperatures 0, 0.3 and 0.7, each with repair, and abstained when no answer had a large enough share.

![Panel (a), invented values: three drafts give 12,400,000, 12,400,000 and 9,850,000, so two agree and the system answers 12,400,000; for another question the drafts give 37, 41 and a crash, so it abstains. Panel (b), 1,000 public questions: code3 one draft 622 right / 219 wrong / 159 abstain, PA 0.403; with a vote of 3, 586 / 110 / 304, PA 0.476; with value rules replayed, 586 / 90 / 324, PA 0.496.](./figures/04_vote.png)

The vote dropped 109 wrong answers and gave up 36 right ones: a net +73 points, PA 0.403 to 0.476 (± 0.022). The trade works because agreement is a real signal. In an earlier check on 100 hard questions from three held-out train shops (official answers), when all three drafts gave the same answer (30 cases), 27 were right (90%).

### 3.2 Cheaper signals that did not work

I tried to find wrong answers without extra drafts. On the same 100 hard train questions (picked by how an earlier run did on them):

| setup | PA |
|---|---|
| 1 draft | 0.22 |
| + a 4B model checks it (yes/no) | 0.06 |
| + the 9B model checks itself | 0.22 |
| 3 drafts + vote | 0.31 |

The 4B checker could not tell right answers from wrong ones (AUROC 0.40 and 0.49 on two tests; 0.5 is a coin). Neither checker improved PA at any threshold. Small models were confident about everything, including their own mistakes. I dropped model checkers and kept rules plus votes.

### 3.3 Value rules

Some wrong answers can be caught by their value alone. The vote run already had one rule, "low share": abstain when the top answer has half of the drafts or less, so with three drafts at least two must agree. I replayed the stored drafts on CPU with two more rules switched on: "shape" (a zero or empty answer is suspect, since only 4 of 2,462 numeric train answers are 0) and "impossible sign" (negative money). Suspect answers become abstains. Wrong answers fell from 110 to 90 and no right answer was lost: PA 0.496. Almost all of the gain came from "shape". I never made a live run with these rules; 0.496 is the replay.

Three variants show how thin the margins were:

- The same two rules on the single-draft run: 0.403 to **0.442** (39 wrong removed, 0 right lost).
- Requiring all three drafts to agree (low-share threshold 0.67): PA **0.339**, because 207 right answers became abstains.
- A selector that picked among code3 drafts and CodeAct answers with hand-tuned rules (best of 18) scored 0.493 on the questions it was tuned on, but **0.476 ± 0.016** on a split by shop: +0.0003 over the plain vote, nothing.

## 4. Why one shot hit a ceiling

### 4.1 What the wrong answers were

I read a stratified sample of wrong answers: 94 of code3's 219 and 110 of the 279 of my first trained CodeAct model, ca1 (a loop that runs code, reads the output and writes again; Part 5), picked across question types and shops. Each class count was then weighted back to 1,000 questions, so the counts carry about ±30% error. Abstains were classified by rule over all questions.

![Grouped bars, estimated failures per 1,000 public questions (stratified sample, about ±30%), code3 one-shot against CodeAct ca1: name linking 47 and 49, answers an unanswerable question 32 and 23, duplicates or row scope 25 and 26, counting rows instead of orders 19 and 25, abstains on an answerable question 19 and 2, unit conversion 17 and 20, time window 12 and 41, money column role 12 and 16, status filter 10 and 41, walk-in customer 4 and 12.](./figures/04_error_classes.png)

The biggest class for both was **name linking**: the question says one spelling of a product or customer, the file has another. An invented example: the question asks about "bac xiu da", the file lists "Bạc xỉu (đá)" and "Bạc xỉu nóng". A one-shot program has to guess the filter string before it has seen a single value; a typo-level mismatch returns an empty result, or the wrong subset.

Code3 also answered 32 questions that should have been "unanswerable", and skipped 49 without an attempt, 41 of them because the prompt overflowed the context window.

### 4.2 Errors that run without crashing

Most one-shot errors were not crashes. They were a multi-condition rule read wrongly, a boundary off by one (772 against 771 at temperature 0: temperature 0 makes the error repeatable, not correct), or data that was not there and was never checked. Such a program runs, returns a plausible number and passes repair. That is the 18-of-22 in the figure above.

The teacher showed the same limit. On 150 questions DeepSeek 4.1 Flash got 137 right writing one shot, and 147 right in a CodeAct loop. On 30 train questions (15 hard, 15 easy), one shot got 17 (only 2 of the 15 hard ones); the loop got 29, then 30 after one format rule was added to its first turn.

### 4.3 Routing did not save it

If some questions need a loop and most do not, maybe I could send only the hard ones to the vote. Routing 238 of 1,000 questions by the tags of their nearest examples scored 0.257 at 1,476 model calls, between one draft (0.171, 1,000 calls) and a full vote (0.289, 3,000 calls). But the routing was fit on the same questions; leaving one shop out at a time, the gain fell to 0.220 at 1.6 times the calls.

I stopped tuning one shot. My first trained CodeAct model, ca1, scored lower (0.346: 625 / 279 / 96), but it failed on different questions (it skipped an answerable question about 2 times per 1,000, against about 19), and the loop could look at data before answering. Part 5 is how the loop got to 0.725.

## Limits

- Every public PA here uses my own labels. One 1,000-question run has an SE of about 0.022 to 0.028, so gaps under about 0.02 are noise.
- The value-rule score (0.496) is a replay on stored answers, not a fresh run (the replay matched the stored predictions on 919 of 920 questions), and it is measured on the same public questions I was studying. The rule thresholds were calibrated on train answers, but public gains may not transfer.
- The error classes come from a stratified read of 94 and 110 wrong answers, weighted to 1,000 questions; treat each count as ±30%.
- The checker and agreement numbers come from small sets of train questions (30 to 100).

## Reproduce

Generate teacher solutions (plan plus code) on train shops only, run each, and keep only rows whose answer matches the train answer. Train a LoRA adapter (rank 32) on the 9B base, merge it into the weights before serving with vLLM, and serve one model per GPU. For each question: build the prompt (rulebook, shop card, three BM25-picked examples, question), draw three drafts at temperatures 0, 0.3 and 0.7, run each in a sandbox with up to two repairs, vote, apply the value rules, and abstain on anything else. One 1,000-question run took about 40 minutes on one L40S for a single draft.

## Sources

- Wang et al., "Self-Consistency Improves Chain of Thought Reasoning in Language Models", https://arxiv.org/abs/2203.11171.
- Hu et al., "LoRA: Low-Rank Adaptation of Large Language Models", https://arxiv.org/abs/2106.09685.
- Wang et al., "Executable Code Actions Elicit Better LLM Agents" (CodeAct), https://arxiv.org/abs/2402.01030.
- My runs, November 2026: early one-shot k1 and k3 on 1,000 public questions (Nov 8); teacher data generation and verification on train shops; code3 and code0 50-question checks and the code3 1,000-question run with vote (Nov 11); value-rule and selector replays; checker tests on 100 hard train questions; stratified error samples of code3 and ca1.

Written with Claude Code. Numbers checked against the runs under Sources.
