---
title: "Training a 9B student on its own correct answers added 0.07 PA"
description: "Fine-tuning Qwen3.5-9B with LoRA on 4,030 train-shop trajectories, 2,546 of them its own verified rollouts, lifted the vote from 0.725 (base model, fixed vote of 3) to 0.798 (adaptive vote) on 1,000 public questions."
pubDatetime: 2026-11-17T00:00:00Z
kind: series
series: datamate
part: 8
project: datamate
draft: false
tags: [datamate, sft, lora, self-distillation, qwen, training]
---

By November 14 the base model inside my CodeAct loop scored 0.725 on the public set, and its errors were not random: it wrote code that read the wrong column, guessed when it should have stopped, and ran out of turns on hard questions. I had 3,000 train questions with gold answers and two days. This post is how I turned those into training data, the four kinds of GPU I went through, and what the fine-tuning (SFT) changed.

## Key results

- The training set had **4,030 rows** built only from train shops: **2,546** were the base model's own rollouts that reached the gold answer, **1,484** were teacher repairs of its failures.
- The b64 recipe (LoRA rank 32, alpha 64, 2 epochs, 2x H200, 2.67 h of wall time) lifted the vote from **0.725** (base model, fixed vote of 3) to **0.798** (adaptive vote), +0.073.
- Against the first recipe (v1d), b64 added **+0.044** single-sample (paired SE 0.021) and **+0.031** with the vote (SE 0.014).
- A third epoch (ep3, 62 more steps, 1.47 h) is the model I shipped. Its validation loss rose from 0.15674 to 0.159, and in the same harness as b64 it scored **0.804**; epochs 4 to 7 scored **0.771-0.795**.
- Free Kaggle T4s were too slow (450-535 s per step on one GPU); the same code on an H100 ran about **30x faster**.

All public scores in this post are PA on the 1,000 public questions with my own labels: the organisers did not release public gold. PA = (correct − wrong) / n, so a skipped question (abstain) scores 0 and a wrong one scores −1.

## 1. What I trained on

### 1.1 Only train shops, never test

The rule I set first: no public or private question, answer or file goes into training. Every row comes from the 30 train shops, whose 3,000 questions have gold answers. I froze 110 train questions as a validation set, with fixed quotas per answer type (28 number, 14 percent, 10 date, 8 string, 4 boolean, 24 list, 6 table, 16 unanswerable), and removed every row on those questions from training. Six train shops were held out completely for later checks, so training used 24 of the 30.

### 1.2 Student rollouts: the model teaches itself

The cheapest good data was the base model's own work. On a shared 2x L40S machine I ran the base Qwen3.5-9B through the CodeAct loop (Part 5) on 2,368 eligible train questions, 6,000 samples in total, at temperature 0.6 (top_p 0.95, top_k 20, up to 4,000 tokens per call, 0 to 3 worked examples in the prompt). I kept a rollout only if its final answer matched the train gold. That is self-distillation: the model learns from its own successful paths.

### 1.3 Teacher repairs: fixing the failures

Keeping only successes teaches nothing about the questions the model always gets wrong. For those, a teacher model (Claude Haiku 5.5 with low reasoning, or DeepSeek 4.1 Flash) took the failed rollout from its first wrong turn and produced one of four kinds of row: **fix** (correct the failing step, 640 rows), **recover** (continue from a dead end to the right answer, 360), **full** (a full correct trajectory, 298) and **short** (a shorter path, 186). A repair was accepted only if replaying its code on the real kernel reached gold.

The teacher path was noisy. Of 916 accepted records, 821 rows survived checks (yield 0.8963): 53 were dropped for copying a worked example, 15 because the final turn would be masked out of the loss, 8 for length, and 19 more for smaller reasons. 362 of the 742 unique records needed more than one rung of the repair ladder.

### 1.4 From pieces to 4,030 rows

![Data funnel: 2,397 kept student rollouts, plus 186 list/table and 89 unanswerable synthetic rows, plus 777 teacher rows, minus 10 dropped in shuffle, plus 776 rows for a second rule order, minus 185 rows on validation questions, gives 4,030 train rows and 110 validation questions; 2,546 student and 1,484 teacher rows (36.8 %).](./figures/08_data_funnel.png)

Two choices shape the set. First, I added synthetic rows for rare answer types: 305 list/table rows (185 student, 120 teacher) and 74 unanswerable rows (72 student, 2 teacher) in the final set; the funnel shows the counts before the merge and the validation cut (186 and 89), because unanswerable was only 3.5 % of train gold (142 questions) and the model almost never abstained on purpose. Second, every teacher row appears twice with the rulebook shuffled (seeds 0 and 1), so the model cannot learn rule positions instead of rule content.

| property | value |
|---|---|
| rows / distinct questions | 4,030 / 2,392 |
| student / teacher rows | 2,546 / 1,484 |
| rows with worked examples in the prompt | 1,613 |
| total tokens / mean per row / max | 52.22 M / 12,959 / 20,092 |
| tokens that count in the loss | 3.94 M (7.5 %) |
| assistant turns trained | 11,250 |

Only 7.5 % of tokens are in the loss: the prompt (shop views, rulebook, examples) and the code outputs are masked, and the model learns only from its own turns.

## 2. Four platforms in ten days

![Training timeline by platform. Nov 6-12: Kaggle 2x T4 pandas QLoRA on 925 rows took 25,500 s; one-shot code runs went out of memory on 2 GPUs and ran at 450-535 s per step on one; Modal H100 CodeAct ca_v1 on 1,764 rows ran out of credit at step 5, was cancelled by the platform at step 79 and resumed from step 70, and scored 0.346. Nov 14-16: student rollouts and teacher repairs on Nov 14, v1d on 2x L40S (216 steps, 8.4 h, vote 0.767), b64 on 2x H200 (job from about 18:25, training loop 18:37-21:05, vote 0.798), ep3 22:46-00:14, shipped.](./figures/08_training_timeline.png)

### 2.1 Free and credit GPUs (November 6-12)

I started on Kaggle's free 2x T4 with 4-bit QLoRA. A first pandas-style adapter on 925 rows took 25,500 s. The one-shot code adapters (code3 and code0, Part 4) were worse: on two GPUs they ran out of memory at step 2; on one GPU they ran at 450 to 535 s per step against a session cap of 11.3 h. An H100 on Modal was roughly 30x faster (about 5,400 against 180 tokens per second), so the first CodeAct adapter trained there. The credit ran out at step 5; later the platform cancelled the run at step 79, and I resumed it from the step-70 checkpoint.

That first CodeAct adapter (ca1, 1,764 rows) scored 0.346 (625 right, 279 wrong, 96 abstain), below the trained one-shot code at 0.403 and the one-shot vote at 0.476. Part 5 covers why: the loop looked at the data but did not use what it saw, and 90 % of its training rows taught an `assert` habit that broke on real files. I rebuilt the data from scratch with the verified-rollout rule above.

### 2.2 The shared machines (November 14-16)

The final work ran on two shared boxes: 2x L40S for rollouts and the first recipe, 2x H200 for the rest. Two bugs cost me time: a DataLoader crash under multi-GPU training (an object that could not be pickled, fixed on November 14), and a hang on the H200 that went away with `NCCL_NVLS_ENABLE=0`. Reinforcement learning and DPO were judged a no-go: there was no time for a second data loop (Part 7).

## 3. Three recipes

### 3.1 v1d: the first that helped

v1d used LoRA rank 32, alpha 32, dropout 0.05, learning rate 1e-4, batch 32, 2 epochs on 3,458 rows, on the shared L40S pair: 216 steps in 30,240 s (8.4 h, about 3,080 tokens/s). Validation loss went from 0.1772 to 0.1508.

| run | single sample | vote of 3 |
|---|---|---|
| base model | – | 0.725 (809 / 84 / 107) |
| v1d, 8 worked examples | 0.681 (816 / 135 / 49) | 0.764 (847 / 83 / 70) |

The vote rose +0.039, and the gain came from fewer abstains, not fewer errors: wrong answers stayed at 83 against 84. The model answered more questions it had been unsure about, and got them right.

### 3.2 b64: bigger steps from the base

b64 started again from the base weights on the full 4,030 rows: LoRA rank 32, alpha 64, no dropout, on 248 modules, learning rate 2e-4 with cosine decay and 6 % warmup, batch 64 split over 2 H200s (DDP: each GPU holds a copy and they average gradients), max length 20,480 tokens, 2 epochs, 124 steps. The job started at about 18:25 (model load and checks); the training loop ran from 18:37 to 21:05, 2.67 h of wall time in all.

Validation loss fell at each check: 0.17738, 0.1628, 0.15867, 0.15791, 0.15674.

| run | single | adaptive vote |
|---|---|---|
| v1d, 3 worked examples | 0.678 | 0.767 (vote of 3) |
| b64 | 0.722 (841 / 119 / 40) | **0.798** (869 / 71 / 60) |
| paired gain | +0.044 (SE 0.021) | +0.031 (SE 0.014) |

The adaptive vote (Part 9) draws 2 to 5 samples and abstains when they do not agree. Against the base model's vote, b64 is +0.073.

### 3.3 ep3: one more epoch, and four too many

I continued b64 for a third epoch as a warm restart from its epoch-2 adapter, with a fresh optimizer: peak learning rate 1e-4, cosine, 6 % warmup, 62 steps, 72 s per step at 11,522 tokens/s, peak 31.03 GiB per GPU. The run took 1.47 h of wall time (22:46 to 00:14), of which the training loop was 1.27 h. Validation loss went the wrong way: 0.15674, 0.16039, 0.159.

In the same harness as b64 it scored 0.804 (871 / 67 / 62) against 0.798, +0.006 with no paired test. I shipped it anyway, because I had no time for a clean comparison and the gap was small either way.

I also ran four more epochs from ep3's optimizer state at a lower learning rate (5e-5, cosine over 4 epochs). Training loss fell from about 0.17 to about 0.08 while validation loss rose to 0.16618 at epoch 4 and 0.18838 at epoch 7: overfitting. In the same harness they scored 0.771, 0.784, 0.780 and 0.795, all below ep3, so I stopped at 3.

For serving I merged the adapter into the weights in bf16. vLLM's native LoRA path gave the base model's outputs on 8 of 8 test prompts, so merging was the safe path. A first merge in fp16 produced different weights; the shipped merge used bf16 and kept untouched layers as they were.

## 4. What SFT changed

Turns tell the story. On b64 single-sample runs, accuracy falls with the number of CodeAct turns:

| turns used | questions | accuracy |
|---|---|---|
| 1-2 | 401 | 0.938 |
| 3-4 | 409 | 0.878 |
| 5-6 | 114 | 0.702 |
| 7-9 | 45 | 0.578 |
| 10 (limit) | 31 | 0.000 |

None of the 31 questions that hit the 10-turn limit got a right answer. Training made short, confident paths more common; it did not teach the model to rescue a long one.

New industries remained the weak spot. Three public shops come from business types with no train shop. On those 170 questions b64's vote scored 0.571, against 0.845 on shops with a covered industry; they held 73 of the 202 points I lost (36 %). Training on 24 train shops taught the model my shop types, not shops in general.

Finally, the size of the effect. SFT moved the vote from 0.725 to 0.798. The harness work after it (Part 10) moved the same ep3 model from 0.804 to 0.942. Both mattered, but most of the climb did not come from the weights.

## Limits

- Public numbers use my own labels; the private score is unknown when this was written.
- ep3 against b64 (0.804 against 0.798) and the epoch 4-7 scores are single runs, not paired tests.
- Teacher repairs were filtered only by the final answer; a repair can reach gold with a wrong reason.
- Unseen industries (0.571) suggest the private set, which has new shop types, may score lower than the public set.

## Reproduce

I collected 6,000 rollouts from the base model on two L40S GPUs over about 10 hours, then sent the failures to API teacher models over parts of two days (about 3 hours of calls in all). Training used LoRA with PEFT and TRL on two H200 GPUs: stage 1 took 2.67 h of wall time (about 5.3 GPU-hours), ep3 1.47 h (about 2.9 GPU-hours). The adapter was merged into the base weights in bf16 and served with vLLM. Data build is a single script that takes about 15 minutes.

Cost is mostly an estimate. The Claude teacher calls show a CLI cost of about USD 211, which may be notional (I did not record whether it was billed or covered by a subscription); the DeepSeek calls were not metered. The L40S and H200 boxes were shared machines with no bill recorded; the earlier Modal H100 run cost about USD 5-7.

## Sources

- Hu et al., "LoRA: Low-Rank Adaptation of Large Language Models", ICLR 2022.
- Zelikman et al., "STaR: Bootstrapping Reasoning With Reasoning", NeurIPS 2022 (keeping only rollouts that reach the right answer).
- Wang et al., "Executable Code Actions Elicit Better LLM Agents" (CodeAct), ICML 2024.
- Qwen team, Qwen3.5-9B model card (Apache-2.0).
- Hugging Face PEFT and TRL documentation.
- My runs, November 2026: Kaggle and Modal training logs, rollout and teacher-repair folders, data-build provenance and dataset report, training logs of b64, ep3 and epochs 4-7, public evaluations of base, v1d, b64, ep3 and epochs 4-7.

Written with Claude Code. Numbers checked against the runs under Sources.
