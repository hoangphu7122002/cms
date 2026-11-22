---
title: "Ideas I tried that did not ship, and what the numbers said"
description: "Rule retrieval cost 0.16 PA, dropping the column mapper cost 0.80, and my first fine-tuned CodeAct loop scored 0.346 against 0.476 for the one-shot vote: eleven dead ends, measured."
pubDatetime: 2026-11-17T00:00:00Z
kind: fieldnote
series: datamate
part: 7
project: datamate
draft: false
tags: [evaluation, retrieval, agents]
---

A post-mortem usually lists what worked. This one lists what I built, measured and then left out. Most of these ideas looked good on day one: a shorter prompt, a cheaper check, a simpler pipeline. Then a run on 100 or 1,000 questions gave a number below the control, or inside the noise.

Public-set numbers here are scored with my own labels (the organisers did not release public answers). The checker test used train questions with the official train answers. The private score is not known yet.

## Key results

- In the old repo, on 100 public questions against a control of PA **0.51**, four "obvious" improvements lost: rule retrieval **0.35**, compiled rules **0.49**, a question normaliser **0.45**, a vote of 3 **0.44**. Lexical column selection cost **−0.10**.
- Dropping the column mapper and giving a 9B model raw tables plus a profile scored **PA −0.29**, a loss of **0.80**: 10 questions won, 58 lost.
- My first fine-tuned CodeAct loop (ca1) scored **0.346** on 1,000 questions, below the one-shot vote at **0.476**.
- Notes in the tool output telling the model what to do were acted on in **0-2 %** of cases; a debt helper was called **0 times on 29** debt questions.
- Two 1,000-question A/Bs stayed inside the noise: question profile off vs on **+0.027 (SE 0.018)**, the as-of view policy **−0.012 (SE 0.010)**. RL and DPO were a no-go: about **2-3 days** of work with **2.4 days** left.

## 1. How I decided

PA is (correct − wrong) / n; an abstain (declining to answer) scores 0. Where I could, I compared ideas with a **paired** test: the same questions, run with and without the idea, and the difference counted per question. That cancels question difficulty, but not sampling noise.

The noise sets the bar. On 100 questions, one paired comparison had an SE of 0.069, so anything smaller than about ±0.07 is a guess. On 1,000 questions the paired SE was 0.010 to 0.018. Even then, the same greedy config changed about 13 % of answers from one run to the next, and one 1,000-question run was good to about ±0.025.

![Panel (a), 1,000 public questions: question profile off vs on +0.027 ± 0.018; profile fixes on the b64 model −0.005 ± 0.015; as-of view policy −0.012 ± 0.010; first fine-tuned CodeAct vs one-shot vote −0.130 (two separate runs, SE 0.036 derived). Panel (b), 100 questions: old-repo A/Bs against a control of 0.51: examples by retrieval +0.05 ± 0.069, rules compiled −0.02, question normaliser −0.06, vote of 3 −0.07, lexical column selection −0.10, rule retrieval plus compiled −0.14, rule retrieval −0.16, no mapper −0.80 (PA −0.29); on 100 hard train questions a 4B answer checker −0.16 and a 9B self-check 0.00 against one draft at 0.22.](./figures/07_forest.png)

## 2. The old repo: shorter prompts that hurt (November 2-5)

### 2.1 Rule handling

The pipeline of the first week had a semantic layer (Part 3) and Qwen3.5-9B writing one program per question, on rented L40S GPUs. On a fixed set of 100 public questions it scored PA 0.51 with the full rulebook in the prompt (0.33 on all 1,000). I tried five ways to handle rules more cleverly:

| change | PA on 100 q | why it looked good |
|---|---|---|
| full rulebook (control) | 0.51 | – |
| rules compiled into short form | 0.49 | shorter prompt |
| question normaliser first | 0.45 | cleaner text |
| vote of 3 samples | 0.44 | more agreement |
| rule retrieval + compiled rules | 0.37 | shorter prompt |
| retrieve only the top rules | 0.35 | prompt 38-42 % shorter, rule recall 99.6 % / 98.9 % |

Retrieval found 99 % of the needed rules and still cost 0.16 PA. I did not pin down why. A later test in the new repo pointed the same way. On 20 questions that needed about 4.9 rules each, the top 6 rules held only a fraction of them: recall 0.20 for an embedder, 0.25 for BM25 (keyword search), 0.26 for both combined. Fine-tuning the embedder made it worse (0.145 → 0.091). On 1,000 questions with a 4B model, top-6 rules scored −0.464 against −0.425 with all rules (two separate runs, SE about 0.025 each). The rulebook is only about 4.4-5.6k tokens, so from then on all of it went into the prompt.

The vote of 3 is worth a note. At 0.44 it lost here, because it only picked the most common answer. It came back later in a different form, with abstain when the samples disagree, and then it was worth +0.117 (Part 4).

### 2.2 Column selection and examples

Lexical column selection, which kept only the columns whose names matched words in the question, scored 0.41 (63 right, 22 wrong, 15 abstain): −0.10. Worked examples picked by lexical retrieval scored 0.56, +0.05, with a paired SE of 0.069: not conclusive. That example bank was written with Claude and its licence was unclear, so it stayed a measurement only.

### 2.3 No mapper

My boldest simplification was to drop the column mapper and give the 9B model the raw tables plus a column profile. It scored PA −0.29 (23 right, 52 wrong, 25 abstain): 10 questions won, 58 lost, −0.80 in total. It is the only old-repo A/B far outside the noise, and it set the direction for the shop layer in Part 6: a 9B model does not reliably map a messy shop by itself inside one answer.

## 3. A small model as a checker (November 8)

PA punishes a confident wrong answer, so a cheap "is this right?" check looked attractive. I tried a 4B model that answers yes or no, and the 9B model checking itself, on 100 hard train questions with official answers.

| setup | right / wrong / abstain | PA |
|---|---|---|
| one draft | 52 / 30 / 18 | 0.22 |
| + 4B checker filter | 30 / 24 / 46 | 0.06 |
| + 9B self-check | 36 / 14 / 50 | 0.22 |
| 3 drafts + vote | – | 0.31 |

The 4B checker's score had an AUROC of 0.40 and 0.49 on two tests (0.5 is a coin flip). It threw away more right answers than wrong ones. The 9B self-check removed 16 wrong answers and 16 right ones: net zero. A rule-based check passed 222 answers as clean, of which 107 were right and 115 wrong: it caught crashes, not wrong values. Agreement between samples was the only confidence signal that worked; when all 3 drafts agreed, 27 of 30 were right.

## 4. My first CodeAct loop (November 11)

CodeAct lets the model act by writing code: one Python cell per turn, run in a kernel that keeps its variables, up to 10 turns. My first version, ca1, was a fine-tuned adapter trained on 1,764 rows (1,486 verified student rows and 278 teacher rows), with a plain-text fence format and the whole rulebook in the system prompt.

On 1,000 public questions it scored **0.346** (625 right, 279 wrong, 96 abstain, SE 0.028). The one-shot programs it was meant to replace scored 0.403 alone and 0.476 with a vote (SE 0.022). These are separate runs, not a paired test; combining the two SEs gives about ±0.036 on the −0.130 gap, still far outside the noise.

Reading about 200 wrong answers by hand showed why. Errors in the time window rose from about 12 to about 41 per 1,000 questions, and wrong status filters from about 10 to about 41 (estimates, ±30 %). The model printed the right period or the right set of orders, then ignored what it had printed. I kept the loop idea and rebuilt the rest: native tool calls on the untuned base model plus clean views scored 0.579 two days later (Part 5).

## 5. Advice the model ignored (November 14)

After the CodeAct loop worked, I tried to steer it with text. Code guards added notes to the tool output ("remember to exclude cancelled orders"), and the prompt gained a question profile with periods and answer type spelled out.

- **Notes in the tool output** were acted on in 0-2 % of cases. A helper `debt_at()` for debt questions was called 0 times on 29 debt questions.
- **Question profile.** With a vote of 3 on the base model, the profile on scored 0.696 (790 / 94 / 116), off 0.723 (801 / 78 / 121): +0.027 for off, SE 0.018. Inconclusive; I kept it on.
- **Profile fixes on the trained model.** On the b64 model, one sample, fixes on scored 0.717 and off 0.722: −0.005, SE 0.015.

What worked instead was changing the data the model reads. Removing duplicated order lines in the loader, with the model's code unchanged, had moved 355 questions from −0.014 to +0.425 (Part 2). The lesson I kept: put the fix in the data, not in a sentence.

![A table of eleven ideas with why each looked good, what I measured, and its fate: rule retrieval, lexical column selection and the 4B checker were dropped; no-mapper, the old vote, ca1, nudges, the question profile and the as-of policy were kept or reshaped; model-written views were not fixed in time; RL/DPO was not run.](./figures/07_looked_good.png)

## 6. Two that only looked dead (November 16)

**The as-of view policy.** Version n3 added one policy: cut each table at the question's `as_of_date` in the way that fits it (installment contracts by purchase date, payment schedules never dropped). Total PA fell from 0.919 to 0.907, −0.012 with SE 0.010. The paired split showed +7 points on the 20 questions it touched, and the loss coming from elsewhere (Part 10). I kept the policy from n4 on.

**Model-written views, rewritten every run.** For tables my code could not map, the model writes a small view in pandas. In n3 those views were rewritten from scratch and kept only in memory; on two shops the new views cost 7 points each, −13 net. The fix, caching validated views per shop in the image, was proposed after n3 and not built before the deadline. This one is a real dead end of the shipped system.

## 7. RL and DPO: a no-go

On November 14 I asked whether reinforcement learning could optimise PA directly. DPO (direct preference optimisation) trains on pairs of a better and a worse answer; GRPO, an RL method, compares several samples of one question. I checked the data and the schedule before writing any code:

- **Time.** Online RL needed a new rollout recorder (the harness kept token counts, not token ids), a way to sync LoRA weights into vLLM, and a 6-12 h run: about 2-3 days of work, with 2.4 days to the deadline.
- **Little signal.** Per-sample accuracy on train questions was already 0.88-0.90. For DPO there were 230 questions with both a right and a wrong sample, plus 72 with a right sample and an abstain: 6-9 % of the train set.
- **It could undo the vote.** The vote was worth +0.114 to +0.117 PA, and it works because samples disagree. RL that sharpens the policy makes samples agree more, wrong ones included.

I spent the time on SFT instead (Part 8).

## Limits

- Old-repo A/Bs are single 100-question runs; only the no-mapper result is clearly outside the noise.
- ca1 against the one-shot vote is two separate runs, not a paired test; its SE is derived from the two runs' SEs.
- The checker test used 100 train questions picked because an earlier run found them hard; it says little about easy questions.
- Public numbers use my own labels. Several later fixes were guided by public error analysis, so public gains may not transfer.

## Reproduce

The old-repo A/Bs ran Qwen3.5-9B with vLLM on rented single L40S GPUs, 100 public questions per arm, a few minutes per arm. The checker test used 100 hard train questions. The ca1 run took 15.5 minutes for 1,000 questions on one H100; the 1,000-question A/Bs ran on L40S and H200 GPUs, up to about 1.7 hours per arm for a vote of 3. All paired comparisons use per-question scores in {+1, 0, −1} and the standard error of their differences. The RL decision was a paper study with no GPU run.

## Sources

- Wang et al., "Executable Code Actions Elicit Better LLM Agents" (CodeAct), ICML 2024.
- Robertson and Zaragoza, "The Probabilistic Relevance Framework: BM25 and Beyond", 2009.
- Rafailov et al., "Direct Preference Optimization: Your Language Model is Secretly a Reward Model", NeurIPS 2023.
- Shao et al., "DeepSeekMath: Pushing the Limits of Mathematical Reasoning in Open Language Models", 2024 (GRPO).
- My runs, November 2026: old-repo 100-question A/Bs and rule-retrieval tests, the checker test on hard train questions, the ca1 and one-shot 1,000-question runs and their error reading, the question-profile and n2/n3 paired comparisons, the RL feasibility note.

Written with Claude Code. Numbers checked against the runs under Sources.
