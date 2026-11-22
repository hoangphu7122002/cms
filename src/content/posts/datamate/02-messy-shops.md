---
title: "Messy shops: when reading the files was the model's job"
description: "Removing duplicated order lines, with the model's code unchanged, moved PA on 355 held-out questions from -0.014 to +0.425; four untouched baselines all scored below the 0 of skipping every question."
pubDatetime: 2026-11-17T00:00:00Z
kind: fieldnote
series: datamate
part: 2
project: datamate
draft: false
tags: [table-qa, abstention, benchmarking]
---

When I restarted on November 5, I gave a 9B model the raw tables, the whole rulebook and the question, and let it write pandas. It lost points on every run. The model was not bad at pandas; it was doing two jobs at once, reading broken files and answering questions, and it was bad at the first one. This post is about the files, and what changed when code took that job away.

## Key results

- Four baselines (X1-X4) with raw tables in the prompt scored **-0.415 to -0.468** on 1,000 public questions. Skipping every question scores **0**, so all four were worse than doing nothing.
- In X4, **107 of 253** abstains were prompts too long for the 16,384-token window: the files did not even fit.
- Replaying the **same model code** after an order-key dedupe moved 355 held-out train questions from PA **-0.014 to +0.425** (wrong answers 115 to 37).
- Data-only fixes on a 1,000-question public run moved PA from **0.171 to 0.225** (re-measured), again with the model's code unchanged; a simulation of the remaining fixes gave about **0.303**, but that last step was never re-run.
- After the loader learned to read quantities like "1 bao 25kg", it rescued **1,809 of 1,809** cells that had become empty, and a 30-question CodeAct check went from 28/30 to 30/30.

## 1. What the shops look like

### 1.1 The files

Train has 107 Excel files, 20 CSV files and 1 SQLite file across 30 shops; public has 69, 10 and 1 across 14 shops. A shop may split one year across twelve sheets, keep orders and order lines in different files, or write a README of any quality, or none.

The mess follows a fixed menu, the same in train and public, which suggests a generator that dirtied clean data on purpose:

- **Duplicated detail rows.** One shop had 1,188 of them. The rulebook says identical lines of one order are an export error.
- **Total and subtotal rows** inside the data, and **repeated header rows** halfway down a sheet.
- **Grouped cells**: order code, date and customer written only on the first line of each order, blank below.
- **Money** as "1tr2" (1.2 million dong), "38.5k", "55.000đ", or plain numbers.
- **Dates** as dd/mm strings, ISO strings and Excel serial numbers in the same shop.
- **Status labels** in many spellings: 46 different spellings across 38 shops; one shop alone wrote order status 7 ways.
- **Column names** without accents or abbreviated: 128 such names across more than 20 shops, with no descriptions.

### 1.2 One invented sheet

The figure shows the defects on an invented cafe sheet (not competition data).

![Panel (a): a 10-row invented raw sheet with 8 marked defects: a title line above the header, blank grouped cells, a duplicated order line, an Excel serial date (45751) next to two other date formats, money as 58k, 35.000đ and 1tr2, a total row, a repeated header and status in several spellings. Panel (b): the loader output, 4 typed lines with ISO dates, integer money, a split unit column and a status class.](./figures/02_messy_sheet.png)

Ten raw rows hold four real order lines. A model that sums the "Thành tiền" (amount) column of the raw sheet counts the duplicate, the total row and a cancelled order, and cannot add "58k" to "35.000đ" without parsing both first.

## 2. Letting the model read the files (X1-X4)

The X runs, on November 5 and 6, were my honest baseline in the new codebase: one sample, no examples in the prompt, no repair, the whole rulebook, a card describing the raw tables, and the model writes code.

![Stacked bars over 1,000 public questions: skipping every question gives PA 0.000; X4 Qwen3.5-9B 166 right / 581 wrong / 253 abstain = -0.415 (107 abstains were prompts too long); X1 Qwen3-4B 186/611/203 = -0.425; X2 Qwen3-4B with top-6 retrieved rules 180/644/176 = -0.464; X3 Qwen3-14B-AWQ 181/649/170 = -0.468.](./figures/02_x_runs_outcomes.png)

| run | model, rules | right / wrong / abstain | PA | notes |
|---|---|---|---|---|
| X4 | Qwen3.5-9B bf16, full rulebook | 166 / 581 / 253 | -0.415 | 27.5 min on one L40S |
| X1 | Qwen3-4B-Instruct, full rulebook | 186 / 611 / 203 | -0.425 | 2x T4, 244 min |
| X2 | Qwen3-4B, top-6 retrieved rules | 180 / 644 / 176 | -0.464 | rule retrieval hurt |
| X3 | Qwen3-14B-AWQ, full rulebook | 181 / 649 / 170 | -0.468 | ran about 8 hours |

Three readings:

1. **Wrong outnumbered abstain about 3 to 1.** Every model was confident when it was wrong. With PA, that is the worst possible habit (Part 1, Section 2).
2. **Model size did not help.** The 14B model was the worst of the four. The 4B and 9B models were within 0.010 of each other.
3. **Many wrong answers were close.** 128 wrong numbers were within 10% of my label: right idea, wrong rows (a duplicate kept, a cancelled order counted), not nonsense.

The prompt was also too big. In X4, 107 of the 253 abstains were questions whose prompt plus 2,048 answer tokens did not fit into 16,384 tokens. Later I measured a typical one-shot prompt at 8,182 tokens: the rulebook took 54% and the shop card 32%, while the model used only about 6.8 of 87 rules and 2.2 of 9 tables. I raised the window to 20,480 tokens, which fixed the overflow but not the wrong answers.

## 3. Same code, better data

The turning point came on November 7, with a test I used many times afterwards: **keep the model's code fixed and change only the data it runs on.** If the score moves, the data was the problem.

### 3.1 Duplicates

My first trained pandas adapter had lifted 355 questions from three held-out train shops from PA -0.135 to -0.014. An error read showed 118 code crashes among the abstains (44 TypeError, 23 KeyError from columns lost in joins), and that 251 of the 355 programs never dropped duplicates.

I added a dedupe to the loader: in a table written per order, a line identical in every cell to an earlier line of the same order is dropped. The order code is found from the structure (a column whose values repeat in blocks and look like document numbers), not from column names, so it works on unseen shops. Then I replayed the same 355 programs.

![Panel (a), 355 held-out train questions: base 9B 57/105/193 (PA -0.135), with the pandas LoRA 110/115/130 (-0.014), same code on deduplicated data 188/37/130 (+0.425). Panel (b), 1,000 public questions, same code: k1 run 0.171, lowercase text 0.197, merge unaccented names 0.225 (both re-measured), remaining fixes simulated at 0.303 (hatched bar).](./figures/02_same_code_better_data.png)

Right answers went from 110 to 188 and wrong ones from 115 to 37; abstains stayed at 130. Accuracy on answered questions rose from 49% to 83.6%, and PA from -0.014 to +0.425 (SE 0.036). The adapter's own gain of +0.12 had been smaller than the gain from one loader rule. Train shops have official answers, so this pair is not scored with my labels.

### 3.2 A pass of small data fixes

On November 8 a 1,000-question public run (Qwen3.5-9B with the early pandas adapter, one sample, temperature 0) scored 0.171. I read its wrong and abstained answers and found 67 caused by the data, not the model. Fixing only the data and re-running the model's own stored code, step by step:

| fix (cumulative, model code unchanged) | PA | how |
|---|---|---|
| run as measured | 0.171 | measured |
| lowercase all text | 0.197 | re-measured |
| merge names typed without accents into the accented spelling (+14 questions, none worse) | 0.225 | re-measured |
| the rest: walk-in customers ("kl", "khách lẻ"), status labels, staff nicknames | about 0.303 | **simulated**, not re-run |

Only the first two fixes were applied and scored again. The last row is a simulation of what the remaining fixes would add, so the measured gain from data alone is +0.054; +0.132 is a simulated estimate.

These public findings were then turned into general loader and card rules. The card used to hide rare labels behind "+4 more"; the model could not filter on a status it had never seen, so the card now shows every value of small categorical columns. Splitting "2 ly" into number + unit touched 18 columns with 0 false hits. Where a fix was not certain, I wrote an "ambiguity line" into the card instead of changing the data: code fixes only when exactly one safe reading exists, otherwise the model sees the candidates.

### 3.3 The loader I kept

By November 13 the loader did all of this in code, once per shop: find the header row under any title lines, drop empty, total and repeated-header rows, fill down grouped cells when safe, drop duplicate order lines, merge monthly sheets into one table, parse dates (including Excel serials) and money in all notations, split quantity and unit, merge accent variants, and map each status label to completed, cancelled, returned or in progress from the data plus a small seed list.

On November 10 it learned to read quantity cells such as "1 bao 25kg", which earlier versions had turned into empty values. It rescued 1,809 of 1,809 such cells, and a CodeAct check on 30 train questions, with DeepSeek 4.1 Flash as the model, went from 28/30 to 30/30 with fewer model calls (50 to 43). Speed was never the problem: the first reader cleaned all 44 shops in 102 seconds, and a faster Excel engine (calamine) later cut reading from 150 s to 29 s.

## 4. What did not work

- **Keyword lists for status words.** A status map written after seeing all 44 shops still missed 3 spellings. I moved to reading the classes from the data (negative or zero amounts, refund columns, order transitions), with the list only as a seed.
- **Rule retrieval to shorten the prompt.** Picking the top 6 rules made X2 worse than X1 (-0.464 against -0.425). Retrieval recall at 6 was only 0.20 to 0.26, and a fine-tuned embedder did worse (0.145 to 0.091). The rulebook is only about 4,400 to 5,600 tokens, so I kept it whole.
- **Answering 0.** In the very first run (November 2), 149 of 1,000 answers were 0. In train, only 4 of 2,462 numeric answers are 0, so "a 0 result means abstain" became a cheap, almost free rule.

## Limits

- The public data fixes in Section 3.2 were found by reading public errors. They are general rules (lowercase, accent merge, unit split), but I picked them by looking at the public set, and that set is scored with my own labels. Only 0.171 -> 0.225 was re-measured; 0.303 is a simulation.
- The dedupe replay is on 355 questions from three shops; its SE is 0.036.
- X1-X4 used different hardware and run lengths; they are single runs.

## Reproduce

Each X run answered 1,000 public questions with one sample and no repair: X4 took 27.5 minutes on one rented L40S (about 1 USD); X1-X3 ran on free 2x T4 notebooks, from about 4 hours (X1, 244 minutes) to about 8 hours (X3). The replays need no GPU: store each question's generated code, rebuild the shop tables with the new loader, re-run the code on CPU, and score again.

## Sources

- SheetBrain (dropping its understand-the-sheet step cost 3.3 points) and "Walk Before You Run" (explore the data before solving): both argue for understanding before code; I found the same.
- pandas documentation on `drop_duplicates` and Excel date serials.
- My runs, November 2026: baselines X1-X4 on 1,000 public questions; the 355-question held-out replay before and after dedupe; the 1,000-question k1 data-fix replay and simulation; loader NaN and quantity tests; 30-question teacher checks on train questions.

Written with Claude Code. Numbers checked against the runs under Sources.
