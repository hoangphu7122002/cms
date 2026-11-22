---
title: "The layer adaptation harness: keep the solver generic, adapt the shop"
description: "Turning off the clean shop views dropped the same 9B solver from PA 0.579 to 0.173 on 1,000 public questions; a code-only mapping draft matched hand labels on 385 of 396 column roles."
pubDatetime: 2026-11-17T00:00:00Z
kind: concept
series: datamate
part: 6
project: datamate
draft: false
tags: [table-qa, agents, fine-tuning]
---

Every DataMate shop writes its books differently. One calls the order code `Mã HĐ`, another `so_phieu`; one marks cancelled orders "huỷ", another keeps status in a separate sheet. A solver that rediscovers this for every question spends its turns on plumbing. My answer, the layer adaptation harness, is a thin adapter per shop, built mostly by code, that turns each folder of files into the same small set of clean tables.

All PA numbers in this post are on the 1,000 public questions, scored with my own labels (the organisers did not release public answers). The private score is not known yet.

## Key results

- With views on, the base Qwen3.5-9B CodeAct solver scored **0.579** (760 right / 181 wrong / 59 abstain); with views off and raw tables in the prompt, the same solver scored **0.173** (557 / 384 / 59). One sample per question, one run each.
- A code-only mapping draft matched hand mappings on **385 of 396 roles (97.2%)** and **119 of 121 table types** on 25 train shops not used as examples.
- The draft survives accent-free text, shuffled columns, a missing README and reordered sheets (**128/128** roles kept), but **English headers keep only 48/128** roles.
- Inside vote runs, samples that read a raw table were right **54-57%** of the time; samples that used views only were right **85-86%**.
- One lesson from the last day: views written by the LLM at run time are not stable. In one batch they cost a net **13** questions, because they were rebuilt on every run.

## 1. The idea

### 1.1 Generic solver, per-shop adapter

PA is (correct − wrong) / n; an abstain (declining to answer) scores 0. Most first-week wrong answers were plumbing, not reasoning: the wrong money column, a missed status label, duplicated order lines counted twice.

The harness splits the work in two:

- **Per shop, once, mostly code.** Read the files, decide which table is which and which column plays which role, and build clean canonical tables with English column names. I call these tables **views**: `sales_lines`, `orders`, `purchase_lines`, `payments`, `products`, `unit_conversions`, and later a few industry views (installments, debt book, repair jobs, toppings).
- **Per question, generic.** The CodeAct solver from Part 5 sees the same view names in every shop, plus a short card per view of at most 300 tokens.

The bet: a 9B model can reliably write a one-line sum over `sales_lines` filtered by `counts_as_revenue`. It cannot reliably rediscover, in 10 turns, that this shop stores money as "38.5k" and cancels orders in a separate sheet.

### 1.2 Where the idea came from

I first saw the effect on November 2 in the old repo. A hand-built "oracle" layer, for diagnosis only, lifted every model I tried by 23 to 47 correct answers out of 100 (Part 3). Then I measured how well each way of building the layer reproduced it, by running fixed reference code on 1,000 questions over the built tables:

| how the tables were built | reference answers right, of 1,000 |
|---|---|
| hand-built oracle layer | 996 |
| generic builder + hand-written role config | 923 |
| generic builder + automatic mapper (rules + 9B model) | 619 |
| rules only, no model | 523 |
| automatic mapper v2 | 814 |

The builder was fine; the mapper, the step that decides "this column is the order code", was the gap. The new harness is mostly a better mapper.

## 2. How it works

![The layer adaptation harness in three rows. Per shop: loader, profile, code draft with 8 table types and 15 roles, optional LLM fix, checks, one repair turn, a gate that fails open, then views and cards. Per question: normaliser, time window, entities, question analysis, rule subset. Per answer: CodeAct solver over views. An LLM view writer covers unmapped tables with 3 tries.](./figures/06_harness_arch.png)

### 2.1 shop.mapping: draft, check, repair, gate

1. **Load.** `shop.loader` reads CSV, Excel and SQLite. It finds the real header row (some sheets start with a title block) and fills down continuation rows.
2. **Profile.** Code summarises each column: its value type (code, text, number, money, date) and a few sample values.
3. **Draft.** Code proposes a table type for each table and a role for each column, using only closed vocabularies: **8 table types** (sales line, sales order, purchase line, purchase receipt, product catalogue, unit conversion, stock, other) and **15 roles** (order id, order date, product name, quantity, unit price, line amount, status, ...). On November 10 I cut these lists from 24 types and 50 roles, because the bigger lists were too ambitious to fill reliably.
4. **Optional LLM fix.** One model call per shop, with 3 fixed examples, sees the profile, the draft, and the failed checks, and may edit the draft. My final image did not use it: the shipped config builds the mapping from the code draft alone.
5. **Checks.** Code tests the mapping against the data, for example: line amounts must equal quantity × price on at least 95% of rows; at least 98% of line rows must join to an order; a date column must parse on at least 95% of rows; repeated header rows must stay under 5%.
6. **One repair turn**, then a **gate.** A role or table that still fails is dropped. The shop is never dropped. If everything fails, the solver gets the raw tables (I call this fail-open).

An example from a train shop shows why the checks matter. The draft once read the order-id header as boilerplate. The result was 33,332 "orders" instead of 14,992, because every line became its own order. The join check caught it.

### 2.2 shop.views: apply the rules once

Once roles are known, `shop.views` builds the canonical tables and applies business rules **once**, not once per question:

- a status per line and per order, from whichever sheet holds it;
- `counts_as_revenue`, so cancelled and returned lines drop out of revenue in one filter;
- `line_kind` (product, service fee, voucher, shipping fee, points), each with a fixed revenue flag;
- `base_quantity`, with box-to-piece unit conversions already done.

Columns without a role ride along under their file names, so the solver can still reach an odd column. Each view gets a short card, and each shop gets up to 10 lines mapping rulebook terms to its columns.

### 2.3 Tables no view covers

Some shops have tables none of the 8 types fit. For these, the same 9B model writes a view at run time: up to 3 tries, each checked by code, with the exact error fed back after a failed try. I added this on the last day. Section 4 shows what it cost.

## 3. Evidence that it generalises

### 3.1 Code draft against hand mappings

On November 12 I hand-mapped all 30 train shops. All 30 passed the structural gate, and the views reproduced 78 of 78 monthly-revenue gold values (the code draft alone: 76 of 78). 22 shops needed no change to the draft; 8 needed between 1 and 8 changed cells.

On the 25 train shops not used as examples, the code draft agreed with the hand mapping on 119 of 121 table types, 385 of 396 roles (97.2%), and the status source in 23 of 25 shops. These numbers are an upper bound: each hand mapping started from the draft, so a reviewer may have kept a borderline draft choice.

### 3.2 Perturbations

I then broke 7 shops on purpose (35 tables, 128 roles) and counted how many roles the draft still found:

![Panel (a): code draft against hand mapping on train shops, 76 of 78 gold values, 119 of 121 table types, 385 of 396 roles, 23 of 25 status sources. Panel (b): roles kept under perturbations, 128 of 128 for accent-free text, column order, README removed and sheet order; 112 of 128 for abbreviated headers; 48 of 128 for English headers; renamed files went from 33 of 128 to 122 of 128 after a same-day fix.](./figures/06_perturbation.png)

| perturbation | roles kept (of 128) |
|---|---|
| accents removed, columns shuffled, README removed, sheets reordered | 128 each |
| abbreviated headers | 112 |
| files renamed in English | 33 → 122 after a fix |
| headers translated to English | 48 |

The draft reads Vietnamese header words, so English headers break it; I left this weakness open. (The old repo's mapper showed the same weakness: role recall 0.69 on generated shops with an English language swap.) Renamed files were a real bug: the draft trusted file names. A fix the same day lifted it to 122 of 128 (113 of 119 with neutral names).

With 9 rulebook variants the industry was found 2 of 9 times (4 of 9 after a fix). Of 6 fail-open scenarios, 1 crashed on a corrupt hand-written mapping file; I fixed it. A sweep over all 44 shops raised 0 exceptions.

## 4. What the views are worth

### 4.1 Views on against views off

On November 13 I ran the same CodeAct solver on all 1,000 public questions twice, one sample each, base Qwen3.5-9B with no fine-tuning, in the setup that became my final CodeAct config. The two runs went side by side, one per L40S card of a shared machine. Only the data layer changed:

- **Views on:** view cards in the prompt and 8 worked examples written over views.
- **Views off:** the full raw schema and the full shop README in the prompt, and 8 worked examples over raw tables. One guard that reads views was turned off.

Everything else was equal. The median first prompt was 14,281 tokens with views and 16,480 without.

![Panel (a): views on 760 correct, 181 wrong, 59 abstain, PA 0.579; views off 557 correct, 384 wrong, 59 abstain, PA 0.173. Panel (b): answered samples that read a raw table were right 54% and 57% of the time in two vote runs, against 85% and 86% for samples that used views only; on the same questions, 55.5% against 65.6% and 65% against 70%.](./figures/06_views_onoff.png)

Turning views off cost 203 correct answers and added 203 wrong ones; abstains stayed at 59. PA fell by 0.406, far beyond the SE of about 0.025 on 1,000 questions. Without views, the model did not skip more questions; it answered them wrongly.

### 4.2 Inside the vote runs

The on/off pair is one run each. A second, finer view comes from two later vote runs. In those runs, 14-15% of answered samples read at least one raw table. They were right 54% and 57% of the time; samples that used views only were right 85% and 86%.

Part of that gap is selection (harder questions push the model toward raw tables), so I also compared samples **within the same question**: 55.5% against 65.6% (run A, 102 questions) and 65% against 70% (run B, 78 questions). The gap shrinks but does not close.

### 4.3 Where it still falls short

Three public shops are in industries no train shop covers. On the SFT model with a vote they scored PA 0.571, against 0.798 overall, and accounted for 73 of the 202 points I lost (36%). Several final-week fixes (an installments view, a repair-jobs view, an order-amount check) were written while reading public errors, and some fire on a single public shop; those gains may not carry to the private test.

## 5. The n3 lesson: views must be stable

On the last day the LLM view writer ran inside every evaluation. Batch n3 added a date policy for one public shop's views and fell from 0.919 to 0.907 (−0.012, SE 0.010, not significant). The targeted shop improved, from 0.100 to 0.450 on its 20 questions (+7 net). The other shops lost 19 questions net, including 9 to sampling and vote noise and 13 net to the view writer itself. Two shops show it best (the −7 is each shop's whole change, not a share of the 13):

- in one shop (−7 on that shop), the writer rebuilt a view with columns in the reverse order;
- in another (−7 on that shop), it built an extra view that the previous run had failed to build, and the answers on that shop changed.

One cause: views were cached only in memory, so every run wrote them again and got a different table. The fix I proposed, after the deadline, is to cache validated views per shop inside the image. Build the layer with an LLM if you must, but freeze it before you measure.

## Limits

- All PA values use my own labels on the public set; the organisers' answers may differ.
- The views on/off result is one sample each on 1,000 questions, run once, on the base model. The views-on numbers are in saved analysis notes; the views-off numbers are only in my session logs and run inventory, not in a saved result file.
- The raw-table against views-only sample accuracies (54-57 % against 85-86 %, and the within-question 55.5/65.6 % and 65/70 %) come from my session notes; I did not re-check them against a saved result file.
- The draft-vs-hand agreement is an upper bound, because each hand mapping started from the draft.
- The perturbation tests cover 7 train shops and 128 roles; English headers remain a known weakness.
- Final-week builders were written against public errors; some fire on one public shop, so public gains may not transfer.

## Reproduce

All mapping, check and perturbation tests run on CPU, with no model call when the mapping comes from the code draft. The views on/off pair used Qwen3.5-9B in bf16 under vLLM, one sample per question, on a shared machine with two L40S cards, one run per card at the same time; the views-on run took 3,358 seconds (56 minutes), the views-off run 84 minutes. Hand-mapping a new shop takes an estimated 10-15 minutes (clean export) to 45-60 minutes (unusual layout).

## Sources

- Wang et al., "Executable Code Actions Elicit Better LLM Agents" (CodeAct), ICML 2024.
- Rahm and Bernstein, "A survey of approaches to automatic schema matching", VLDB Journal, 2001 (background on column-role matching).
- Qwen team, Qwen3.5 model card.
- My runs, November 2026: the old-repo layer and mapper measurements (1,000 questions, reference code); the mapping generality and review notes on 30 train shops with perturbations; the views on/off pair and two vote-run failure analyses on the public set; the last-day batch notes (n2, n3).

Written with Claude Code. Numbers checked against the runs under Sources.
