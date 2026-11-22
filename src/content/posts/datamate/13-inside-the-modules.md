---
title: "Inside the modules: every model step in DataMate has a code fallback"
description: "Module by module through my final pipeline: in run n2, 969 of 1,000 answers passed the code checks clean, 31 went to abstain, and the two model checkers changed none."
pubDatetime: 2026-11-17T00:00:00Z
kind: concept
series: datamate
part: 13
project: datamate
draft: false
tags: [datamate, architecture, codeact, table-qa, module-design, abstain]
---

[Part 12](./12-whole-system-architecture.md) drew the whole system on one page. This part opens each box: what a
module is responsible for, what it reads and writes, its key parameters, how it fails, and one number that shows it
matters. Limits and parameters come from the module READMEs and the resolved configuration of the submitted image;
counts come from the traces of run n2 (1,000 public questions, PA 0.919). Public numbers are scored with my own labels
(the organisers released no public gold).

## Key results

- **One shared board, no imports between modules.** Every module reads named fields of one context object and writes
  its own. Each flag defaults to off and leaves the old prompt byte for byte unchanged. The final solver step sets
  106 parameters, 69 of them flags turned on.
- **The shop layer is code; its one model step is the weakest link.** The loader, mapping draft and views run with
  no model call. The view writer (model) kept 2 views in n2; 8 tables failed all 3 tries.
- **The CodeAct loop rarely runs out of road.** Of 2,313 solver samples in n2, 2,266 ended with an answer, 44 hit
  the 10-turn cap and 3 stopped on a repeated error. The median sample used 3 turns.
- **Most of the decision is code.** 876 of 1,000 questions stopped after 2 agreeing samples. Tier-1 (a model check)
  ran on 111 and adopted no repair. Code rules sent 31 answers to abstain.

## 1. The contract every module signs

![Seven module boxes with typed ports: input pins on the left (what the module reads), output pins on the right (what it writes, with sizes: 8 table types and 15 roles, view cards up to 300 tokens each and about 1.1k per shop, analysis up to 512 tokens, turn-0 prompt median 14.3k tokens, 2-5 candidates). Blue badges mark the four modules that also call the model.](./figures/13_module_ports.png)

The pipeline runs at three levels: once per split (the rulebook), once per shop, once per question. All modules share
one `Context`; the docstring states the rule.

```python
@dataclass
class Context:
    """The board modules read from and write to. Modules never import each other; they share this."""
    split: dict                      # name, rulebook_path, calendar_path, ...
    shop: Shop | None = None         # tables keep the ORIGINAL column names
    question: Question | None = None
    candidates: list[Candidate]      # one per solver sample that answered
    answer: Answer | None = None
    extra: dict[str, Any]            # new data between modules; documented as Reads/Writes in each README
    trace: list[dict]
```

Three habits kept this board usable at 69 flags:

1. **Reads/Writes tables.** Every README lists the fields a module reads and writes. That list is the contract; a
   module that needs a new field adds a row first.
2. **Default off, byte-identical.** A new flag must reproduce the old prompt exactly when off. Golden-file tests pin
   the SYSTEM text and turn 0 on all 44 shops (30 train, 14 public).
3. **Fail open per unit.** A broken table loses its view, not the shop; a crashed sample loses its vote, not the
   question; a crashed question becomes abstain (0), never a guess (-1).

## 2. shop.loader and shop.profile: technical cleaning

| | |
|---|---|
| Responsibility | Read one shop folder into tables with the file's own column names; no semantics |
| Reads → writes | shop folder → `tables`, `readme`, `meta` (header row, fill-down, dropped rows, status classes, units); `column_profile` |
| Model calls | none |
| Key parameters | header scan of the top rows; qty-unit split when enough cells read as number + unit; parquet cache keyed by a fingerprint of files + parameters |
| Fallback | an unreadable cell becomes NaN and is counted with examples; ambiguous cases are marked, not guessed |

The loader does what a careful analyst does before the first sum. It finds the header under title lines, drops
empty, repeated-header and total rows, merges monthly sheets into one table, parses dates (Excel serials like
`46084`, `1 thg 6 2025`) and money (`25k`, `1tr440`, `55.000đ`), and splits `2 ly` into 2 and the unit `ly`.

Three rules carry most of the value, and all are judged from the data, not from column names:

- **Order key.** A column is an order code only if its values repeat in consecutive blocks (at most 5% coming back
  later) and look like document numbers (`hd001`). Only then are identical lines dropped as duplicates.
- **Fill-down.** A numeric column is filled only if it is blank on at least 98% of a group's later rows and set on at
  least 80% of first rows. A group total is never filled.
- **Status classes.** A status column with 2-30 labels is mapped to completed, cancelled, returned, in progress or
  draft from negative money, refund columns and a small seed lexicon; a contradiction is marked `ambiguous`.

The profile then lists type, null share and values per column (all values up to 35 distinct, else a few samples).

**The number.** On 355 held-out questions from three train shops, replaying the same model-written code on
deduplicated data moved PA from -0.014 to +0.425 (wrong answers 115 to 37). These shops have official gold. One
loader rule beat the gain of my first fine-tune (part 2).

## 3. shop.mapping: draft, check, gate

| | |
|---|---|
| Responsibility | Say which table is what and which column holds which role |
| Reads → writes | `column_profile`, tables, loader status classes → `shop_mapping`, `gate`, `mapping_trace` |
| Model calls | none in the final image (`source: draft`); a one-call model arm exists but was not shipped |
| Key parameters | 8 table types, 15 roles (closed lists); `status_from_loader: true` |
| Fallback | a failing check blocks one view or one role, never the shop; raw tables always stay |

The mapping is the one place where shop-specific meaning is decided, so I kept its vocabulary small. On November 10 I
cut it from 24 types and 50 roles to 8 types and 15 roles (order id and date, product, quantity, unit price, line
amount, status ...). Every other column rides along under its file name.

The draft is code: file and sheet names first, then header patterns (also glued forms like `tinhtrang`), then content.
Then checks run on the data:

| Check | Needs | A failure blocks |
|---|---|---|
| `missing_core` | e.g. a sales line has a date, an amount or price, a product | that table's view |
| `amount_formula` | quantity × unit price − line discount = line amount on ≥ 95% of lines | the view |
| `order_join` | ≥ 98% of line order ids found in the order table | the view |
| `date_role` | ≥ 95% of a date role's cells are dates | the view |
| `header_repeats` | ≤ 5% repeated ids in an order table (else it is a line table) | the view |
| `base_quantity` | quantity × factor = base quantity on ≥ 95% of lines | the role |

A model arm exists: one call per shop with 3 fixed train-shop examples that fixes the draft, then one repair turn.
I did not ship it, for the reason in the README: "LLM output is not reproducible even at temperature 0". The
organisers re-run the image and allow 0.03 PA of drift.

**The number.** Against my hand mappings of 25 train shops, the code draft got 119 of 121 table types and 385 of 396
roles right (97.2%). Its blind spot shows in a perturbation test: with English headers it kept 48 of 128 roles, with
renamed files 33 of 128 (part 6).

## 4. shop.views and the view writer: apply the rules once

![(a) An invented coffee-shop sheet with a title line, filled-down blanks, a repeated line and a total row (hatched), an Excel serial date and money as 25k. (b) The mapping the code draft hands on: table type sales_line, 8 roles, two status labels, one line kind, amount check 5 of 5 lines. (c) What the solver reads: the sales_lines view card (300-token cap), three shop definitions and three facts lines.](./figures/13_view_card.png)

| | |
|---|---|
| Responsibility | Build canonical tables with English columns and business rules applied once; describe them in short cards |
| Reads → writes | mapping, gate, tables, products, unit conversions → `views`, `agent_schema` (cards), `shop_definitions`, `side_cards`, `shop_facts` |
| Model calls | the view writer only: ≤ 4 uncovered tables per shop, 3 tries each |
| Key parameters | card ≤ 300 tokens per view; definitions ≤ 10 lines; side cards ≤ 200 tokens; facts ≤ 12 lines |
| Fallback | a view with a missing role is skipped; raw tables always stay next to the views |

The core views are `sales_lines`, `orders`, `purchase_lines`, `products` and `unit_conversions`; industry views
(installments, debt book, lots ...) appear when the data has them. `sales_lines` carries the columns that used to cause
wrong answers, already computed: `status`, `order_status`, `line_kind` (product, ship fee, voucher ...),
`counts_as_revenue` and `base_quantity`. A revenue question becomes a filter on one boolean column.

The cards are the contract with the solver. On the 44 shops, all cards of a shop together had a median of 1,081 tokens
(max 1,722). The cap is soft: 34 of 44 shops had one card over 300 tokens. The first version cut lines to fit and lost
the `counts_as_revenue` line on 18 of 41 `sales_lines` cards; version 2 never cuts an explanation line.

`shop.facts` marks 22 concepts (customer, cost, stock, debt ...) as PRESENT, ABSENT, EMPTY or PARTIAL, with the table
and column as evidence. What a missing concept means stays with the rulebook and the model.

**The view writer.** It is the one model step on the shop side; in code it lives in `solver.codeact` but runs once per
shop. Each uncovered raw table with at least 5 rows goes to the model with the README, its columns and 15 rows. The
model replies with pandas code defining a `VIEWS` list and a `build(tables)` function. A view is kept only if, in a
child process, the code runs twice within 20 s with the same result, each view is non-empty with a unique key and no
more rows than the raw table, and every declared sum reconciles with the raw column. A failure goes back with the
traceback or the failed numbers; after 3 tries the card says to use the raw table.

**The numbers.** Views on against off, base model, one sample: PA 0.579 against 0.173, with abstains equal (59) and
wrong answers rising from 181 to 384 without views. The view writer is the weak part: in n2 it kept 2 views, 8 tables
failed all tries, and one shop spent 167 s on it. Validated code is cached only within a run, so a re-run can write
different views. In n3 that cost 13 net questions on two shops (part 10).

## 5. question: lexnorm, time window, entities, analysis, rule subset

| | |
|---|---|
| Responsibility | Turn a typed Vietnamese question into a clean text, a date window, matched names and a list of relevant rules |
| Reads → writes | question, as-of date, name index, rulebook contents → `clean_text`, `window`, `entities`, `analysis`, rule subset |
| Model calls | 1 (`question.analyze`): greedy, thinking off, ≤ 512 tokens, 60 s timeout |
| Key parameters | rule subset: ≤ 6 rules, ≤ 800 tokens in turn 0 |
| Fallback | bad JSON or a timeout means no analysis; a wrong field is dropped, the rest kept |

**lexnorm** fixes the language and never the names. Shop names and words glued to digits (`nv001`, `190k`) are
protected first; then a slang table, a Telex decoder (Telex is the common way to type Vietnamese accents with plain
letters) and month shorthands (`T3/2025` to `tháng 3/2025`) apply. It changed 2,137 of 4,000 train and public
questions (53.4%).

**question.time** resolves `{kind, start, end, prev_start, prev_end}` from the as-of date, with 15 kinds (day, week,
quarter, Tết, last N days ...) and the rulebook's conventions (weeks start Monday; "this month" compares with the same
days of last month). On public questions with a parseable window, the reworked rules took main windows from 866 to 875
of 918 and comparison windows from 43 to 53, with no question worse.

**question.analyze** follows "the LLM proposes, the code verifies, the code is the fallback". Prompt median 2,429
tokens, reply about 79. A section number not in the contents, a name that is not a span of the question, or a period
type outside the closed list is dropped. The model's dates are only compared with the code's window, never used. In
n2, 996 of 1,000 calls returned usable JSON; 4 fell back.

**Rule subset.** SYSTEM keeps the rulebook core and a list of the other rules. The question's own rules (BM25 plus
concept cues, plus the sections the analysis named) go in full at the end of turn 0. This cut SYSTEM + turn 0 from a
median of 11,406 to 9,607 tokens on 44 shops (1,901 saved per shop). SYSTEM stays identical for every question, so the
prefix cache still works.

## 6. solver.codeact: the loop core

![State machine of one solver sample: TURN 0, GENERATE (model, at most 3,072 tokens and 3 tool calls), PARSE, EXECUTE (kernel cell, 30 s), OBSERVE, back to GENERATE; final_answer or cannot_answer ends in CANDIDATE (2,266 of 2,313 samples). Three stop states: turn cap (44), same error (3), context. Guard events in n2: answer-type reminder 110, finish nudge 141, precedence warning 27.](./figures/13_codeact_states.png)

| | |
|---|---|
| Responsibility | Answer one question by writing and running code, a few lines per turn |
| Reads → writes | turn-0 prompt, kernel tables (raw + views) → 0 or 1 `Candidate` per sample |
| Model calls | every turn; ≤ 10 turns, ≤ 3 tool calls per turn, ≤ 3,072 new tokens per turn |
| Key parameters | cell 30 s; 600 s wall per question loop; context 32,768; stable seed per (question, sample, turn) |
| Fallback | a sample without an answer gives no candidate; no candidate at all means abstain |

The model sees three tools, in Qwen's native tool-call format:

```text
run_python(code)                 one cell of a persistent per-question Python kernel
final_answer(type, value, unit)  type in: number, percent, date, string, list, table, boolean
cannot_answer(reason)            the "unanswerable" answer; counts only as the LAST call of a reply
```

Each sample gets its own kernel process (at most 32 at once); variables survive between turns, and helpers such as
`find()` for names and `rule()` for the rulebook sit in the namespace. A cell over 30 s kills the process; a new one
replays the earlier clean cells. `final_answer` becomes the cell `ANSWER = {...}`, so it passes the same
normalise-and-check path as code.

The loop core holds the guards. Each one adds a note to the next observation and never writes an answer:

- an identical cell after an error is not re-run (27 samples);
- the same error twice brings data hints, four times stops the sample (3 samples);
- a length-cut or looping turn is re-asked once at temperature 0.6;
- the last two turns accept only a final answer;
- when room is short, older observations are cut to 800 characters, keeping the last 2 turns.

Notes are weak tools: the model acted on them in only 0-2% of cases. So the fixes that worked went into the views and
the question profile, not into more nudges.

**The numbers.** In n2, samples took 2 turns 853 times and 3 turns 635 times; 75 reached turn 10. The largest prompt
of a sample had a median of 15,370 tokens and a max of 28,254, inside the 32k context. With the same model, moving
from my first fence-format loop to native tool calls plus views took PA from 0.346 to 0.579 (part 5).

## 7. Vote, tier-1 and verifier rules

![Decision tree. Vote: 2 samples at T 0 and 0.3; same answer stops at 2 (876 questions); otherwise one more sample at a time until 3 agree or 5 are drawn (59 questions drew 4, 65 drew 5). Tier-1: skipped when all answering samples agree (889); otherwise a verify call (111), with ok 94, invalid 5, ungrounded 2; a grounded "not ok" starts one repair, adopted only if another sample gave the same answer (0 adopted, 10 rejected). Rules: hard fail 0, grey to abstain 31 (hatched), clean 969.](./figures/13_vote_tree.png)

| | |
|---|---|
| Responsibility | Turn 2-5 candidates into one answer or an abstain |
| Reads → writes | candidates, shop facts, vocab → `vote`, `tier1`, `verdict`, `Answer` |
| Model calls | tier-1 only, when the vote is not unanimous: 1 verify call, at most 1 repair re-run (180 s) |
| Key parameters | adaptive vote 2 to 5 samples (T 0, 0.3, 0.6, 0.3, 0.6); grey if share ≤ 0.5; `vote_guard` and `repair_kind_guard` on |
| Fallback | any doubt keeps the original answer; grey becomes abstain |

**Vote.** Two answers are equal when their types match and the values agree after normalising: money to the đồng,
percents to 2 decimals, names without accents or a trailing phone number. Share is the largest group divided by the
samples drawn: 3 matching answers out of 5 give a share of 0.6 and pass; 2 out of 5 give 0.4, and the answer turns grey and abstains. On my earlier base-model runs, a vote of 3 added +0.117 PA over
the greedy sample alone. Of that, +0.047 came from the plurality and +0.070 from abstaining on weak agreement.

**Tier-1.** The model reads the answer with the code and output and returns a JSON verdict with quotes. A quote must be
found in the text it saw, or the verdict counts as "ok". A grounded "not ok" starts one re-run with the critique. The
repair is adopted only if it differs, the code checks do not get worse, a second verify agrees, and some sample
already gave that answer. These guards came from measurement: without them, tier-1 repairs on vote runs were net -7 to
-8, turning 4 right answers wrong.

**Rules.** Code rules judge the value, never the type:

- **Hard fail:** the main period lies outside the data (then "unanswerable", since no data is not 0), a date more
  than 366 days outside the data, or every sample crashed.
- **Grey:** low share, an empty or zero value, a name the shop does not hold, a number more than 3× the largest
  column sum, a share outside 0-100%, an answer first given on the last turn.

I calibrated each rule on the 3,000 train gold answers: a rule that fires on more than 5% of correct answers is off.
`date_in_range`, `magnitude`, `percent_scale` and `entity_exists` fired on 0 gold answers; `percent_fraction` fired on
12 of 207 and stays off.

**The numbers.** In n2: 969 clean, 31 grey to abstain (30 for low share and 3 for shape; a question can have both), 0 hard fails. On the one-shot system,
the first value rules removed 21 wrong answers and no right ones (0.476 to 0.496, a CPU replay).

## 8. formatter.spec9 and tier-2

| | |
|---|---|
| Responsibility | Put the value in the one official shape of its type |
| Reads → writes | `Answer` (type, value, `meta.unit`), the shop's file spellings → one line `{id, type, answer}` |
| Model calls | tier-2: 1 call per answered question, accepted only through a code guard |
| Key parameters | money to the đồng (half up), other numbers 2 decimals; `money_round_all: true`; `on_invalid: abstain` |
| Fallback | a value that cannot take its shape becomes abstain, because a wrong format scores -1 |

The formatter is plain code. It turns `"12,4%"` and `"4.820.000đ"` into numbers, dates into `YYYY-MM-DD`, tables into
`{"columns": [...], "rows": [...]}`, and a canonical shop value back into the file's spelling ("hòa bình" to "Hoà Bình").

Tier-2 may propose a unit (`vnd`) or a number-to-percent change. Code accepts it only if the formatter recomputes the
same value from the raw answer. A period claim is never an edit, only a request for one re-run.

**The numbers.** n2's output held 577 numbers, 185 percents, 60 strings, 59 lists, 40 dates, 11 booleans, 9 tables,
28 "unanswerable" and 31 abstains. That is seven answer shapes, each with its own way to lose a right value. Tier-2 ran
941 times in n2 and changed nothing; in an earlier 1,000-question run of the same model it ran 913 times, also with no
change.

## Limits

- **Counts from n2, image n6.** n6 added eight small harness fixes after n2. The module boundaries and limits are the
  same; the counts may differ.
- **Two model checks, no measured gain.** Tier-1 adopted 0 repairs in n2, and in another run 5 repairs with a net
  effect of 0. Tier-2 changed nothing in 941 calls. They stay for safety and cost about 1.1 calls per question.
- **The view writer breaks the module rule.** It lives in the solver module, runs per shop, and is not cached across
  runs, which made n3 worse by 13 net questions.
- **Code mapping has blind spots** (English headers, renamed files). Shops in new industries were my weakest group.
- **69 flags is a lot.** Each was default-off and tested byte for byte, but many final-week flags were found by reading
  public errors and some fire on one public shop. The private result is not known yet.

## Reproduce

Limits come from the module READMEs and the resolved configuration of the submitted image. Counts come from one pass
over the n2 traces (1,000 public questions, one H200, about 33 to 35 minutes). The rule calibration (3,000 train gold
answers), view checks and prompt sizes (44 shops, Qwen3.5 tokenizer) run on CPU in minutes, with no model.

## Sources

- Wang et al., "Executable Code Actions Elicit Better LLM Agents" (CodeAct), 2024.
- Wang et al., "Self-Consistency Improves Chain of Thought Reasoning in Language Models", 2023.
- Robertson and Zaragoza, "The Probabilistic Relevance Framework: BM25 and Beyond", 2009.
- Qwen3.5-9B model card and chat template (Qwen, Hugging Face).
- pandas documentation (`read_excel`, `drop_duplicates`).
- My runs, November 2026: module READMEs and resolved configuration of the submitted image; traces of run n2; the
  views on/off pair on the base model; the 355-question dedupe replay on train shops; code-draft and perturbation tests
  of the mapping; rule calibration on train gold; prompt-size audits on 44 shops. Public numbers scored with my own
  labels.

Written with Claude Code. Numbers checked against the runs under Sources.
