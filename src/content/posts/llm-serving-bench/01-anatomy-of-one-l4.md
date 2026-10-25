---
title: "Anatomy of one L4"
description: "What one 24 GB NVIDIA L4 holds when it serves Qwen3-4B, and why it carries about 225 users on our workload where the first baseline carried 16."
pubDatetime: 2026-10-25T00:00:00Z
kind: series
series: series
part: 3
project: llm-serving-bench
tags: [l4, sglang, qwen3-4b, kv-cache, capacity, fp8]
---

## 1. Motivation

One NVIDIA L4 is the unit of this series: the 2 x L4 and 4 x L4 layouts are built from it, and the cost per user is its hourly price divided by its users. This post collects what the card holds in memory and how many users it carries with Qwen3-4B-Instruct-2507. Two of the user numbers below look comparable and are not; Section 6.3 says why.

| | value | kind of number |
|---|---|---|
| GPU | 24 GB (23,034 MiB, about 22.5 GiB usable), 300 GB/s, no NVLink | datasheet, nvidia-smi |
| KV cache per token, bf16 / FP8 | 144 KiB / 72 KiB | computed from the model config |
| Weights in memory, bf16 / FP8 | 7.71 GiB / 4.30 GiB <!-- src: results/g2-baseline-qwen3-4b/20260927-151950/server.log --> | measured (server logs) |
| KV pool, first bf16 baseline | 52,311 tokens | measured (server log) |
| KV pool, final FP8 configuration | about 200,000 tokens | measured (server logs) |
| KV pool used at 225 users | 11 % at peak, 9 requests running | measured |
| Users, bf16 baseline, synthetic load, think time 30 s | strict 0, standard 16, relaxed 28 | measured, 1 seed |
| Users, final FP8 configuration, assistant mix | strict never, standard about 225, relaxed at least 260 | measured, 3 seeds |

**Contents**

1. Motivation
2. Concept: what a serving GPU holds
3. Mechanism: how the engine splits the memory
4. Worked case: the memory of one L4
5. Concept: from requests to users
6. Worked case: the users of one L4
7. Limits, 8. Reproduce, 9. Sources

## 2. Concept: what a serving GPU holds

### 2.1 Three tenants

A serving GPU holds the weights, read once per decode step; the KV cache, one key and one value vector per layer for every token a request has seen; and working memory for activations, CUDA graphs and the runtime.

Take round numbers first. A 24 GB card with 8 GB of weights and 4 GB of working memory leaves 12 GB for the cache. At 100 KiB per token that is about 120,000 tokens; at 50 KiB, about 240,000. Halving the bytes per token doubles the requests that fit, and halving the weights frees more room on top.

### 2.2 Bytes per token

The cost of one token follows from four numbers in the model's config: layers, KV heads, head size and bytes per element. A short function is enough:

```python
import json

def kv_bytes_per_token(config_path: str, kv_bytes: int = 2) -> int:
    """KV cache bytes for one token: K and V, every layer, every KV head.

    kv_bytes: 2 for a bf16/fp16 cache, 1 for an FP8 cache.
    """
    with open(config_path) as f:
        cfg = json.load(f)
    layers = cfg["num_hidden_layers"]
    kv_heads = cfg.get("num_key_value_heads", cfg["num_attention_heads"])
    heads = cfg["num_attention_heads"]
    head_dim = cfg.get("head_dim") or cfg["hidden_size"] // heads
    return layers * kv_heads * head_dim * 2 * kv_bytes   # 2 = K and V

# Qwen3-4B: 36 layers, 8 KV heads, head_dim 128
# bf16 cache: 147456 bytes = 144 KiB;  FP8 cache: 73728 bytes = 72 KiB
```

For Qwen3-4B that gives 36 x 8 x 128 x 2 x 2 bytes = 147,456 bytes = 144 KiB per token in bf16, and 72 KiB with an FP8 cache (computed). A request of the mean size of our workload, 2,004 prompt and 96 answer tokens, holds 2,100 x 72 KiB, about 155 MB of FP8 cache, or 310 MB in bf16 (computed).

## 3. Mechanism: how the engine splits the memory

### 3.1 The memory fraction, step by step

SGLang sizes everything from one knob, `--mem-fraction-static` (vLLM's equivalent is `--gpu-memory-utilization`). The fraction is the share of total GPU memory for weights plus KV pool: after its static allocation, a process leaves (1 - fraction) x total free, counted from the memory free when that process starts. The same round numbers as above, with a fraction of 0.75 (hypothetical):

```
 1 char = 1 GB                       0       8       16      24
                                     |-------|-------|-------|
 step 1  the card                    ........................   24 GB
 step 2  keep (1 - 0.75) free        ..................######   18 | 6 GB
 step 3  load bf16 weights           WWWWWWWW..........######    8 GB
 step 4  KV pool = what is left      WWWWWWWWKKKKKKKKKK######   10 GB
 step 5  same card, FP8 weights      WWWWKKKKKKKKKKKKKK######   14 GB of KV

 W weights   K KV pool   # kept free: activations, CUDA graphs, runtime
```

Step 4 gives 10 GB / 144 KiB, about 68,000 tokens. Step 5, with 4 GB of FP8 weights and an FP8 cache, gives 14 GB / 72 KiB, about 190,000 tokens: almost three times as many from the same card (computed, hypothetical fraction).

Turning the knob by hand did not help us. In a bf16 probe on the L4, a fraction of 0.8 changed nothing and 0.85 ran out of memory. When three models shared one L4, the language model was set to 0.60 and got a pool of 28.8k tokens, which ran 98 % full.

### 3.2 Reading the split from the log

The engine prints each allocation at start, so one command and one `grep` show the split. The model and flags are those of our final configuration; adapt the rest:

```bash
python -m sglang.launch_server --model-path Qwen/Qwen3-4B-Instruct-2507-FP8 \
  --kv-cache-dtype fp8_e4m3 --chunked-prefill-size 256 \
  --attention-backend flashinfer --enable-mixed-chunk --port 30000 \
  2>&1 | tee server.log
grep -E "avail mem|KV Cache is allocated|max_total_num_tokens" server.log
```

Our bf16 baseline (SGLang's default chunk of 4,096 prompt tokens) printed, trimmed:

```console
Load weight begin. avail mem=21.79 GB
Load weight end. ... avail mem=14.08 GB, mem usage=7.71 GB.
KV Cache is allocated. dtype: torch.bfloat16, #tokens: 52311, K size: 3.59 GB, V size: 3.59 GB
Memory pool end. avail mem=4.76 GB
Capture target prefill CUDA graph end. ... mem usage=0.79 GB, avail mem=3.95 GB.
Capture target decode CUDA graph end. ... mem usage=0.13 GB, avail mem=3.82 GB.
```

A later run with the final FP8 flags printed:

```console
Load weight begin. avail mem=21.82 GB
Load weight end. ... quant=fp8, fmt=e4m3, avail mem=17.52 GB, mem usage=4.30 GB.
KV Cache is allocated. dtype: torch.float8_e4m3fn, #tokens: 200084, K size: 6.87 GB, V size: 6.87 GB
Memory pool end. avail mem=1.73 GB
Capture target prefill CUDA graph begin. ... avail mem=1.16 GB
Capture target prefill CUDA graph end. ... mem usage=0.24 GB, avail mem=0.92 GB.
Capture target decode CUDA graph end. ... mem usage=0.21 GB, avail mem=0.71 GB.
```

The log's "GB" is a binary gigabyte (GiB): 52,311 tokens x 147,456 bytes = 7.18 GiB, exactly the K plus V the first log prints (computed). Read every figure below as GiB. The card has 23,034 MiB, about 22.5 GiB usable, so the datasheet's "24 GB" and the log's "GB" are different units.

## 4. Worked case: the memory of one L4

### 4.1 Two layouts

Subtracting consecutive `avail mem` values itemises the whole card. Figure 1 draws the result; the table gives the numbers.

```
 one L4, about 22.5 GiB usable        1 char = 0.5 GiB
                      0         5         10        15        20  22.5
                      |---------|---------|---------|---------|----|
 bf16, chunk 4,096    xWWWWWWWWWWWWWWWKKKKKKKKKKKKKKppppggfffffffff
 FP8, chunk 256       xWWWWWWWWWKKKKKKKKKKKKKKKKKKKKKKKKKKKKppppggf

 x in use before the engine starts    W weights    K K and V cache
 p rest of the pool step (not named)   g CUDA graphs and small gaps
 f free at the end
```

*Figure 1. The memory of one L4 in the first baseline and in the final configuration.*

| step, from the log (GiB) | bf16, chunk 4,096 | FP8 + FP8 KV, chunk 256 |
|---|---|---|
| free when SGLang starts | 21.79 <!-- src: results/g2-baseline-qwen3-4b/20260927-151950/server.log --> | 21.82 <!-- calc: 4.30 + 15.79 + 0.57 + 0.24 + 0.21 + 0.71 = 21.82 --> |
| weights | 7.71 <!-- src: results/g2-baseline-qwen3-4b/20260927-151950/server.log --> | 4.30 |
| pool step | 9.32 <!-- calc: 14.08 - 4.76 = 9.32 --> | 15.79 <!-- calc: 17.52 - 1.73 = 15.79 --> |
| of which K and V | 7.18 | 13.74 <!-- calc: 200084 * 73728 / 2**30 = 13.74 --> |
| free after the pool step | 4.76 <!-- src: results/g2-baseline-qwen3-4b/20260927-151950/server.log --> | 1.73 <!-- calc: 0.57 + 0.24 + 0.21 + 0.71 = 1.73 --> |
| not named, before graph capture | 0.02 | 0.57 <!-- calc: 1.73 - 1.16 = 0.57 --> |
| CUDA graphs, prefill + decode | 0.79 + 0.13 | 0.24 + 0.21 |
| free at the end | 3.82 <!-- src: results/g2-baseline-qwen3-4b/20260927-151950/server.log --> | 0.71 |
| tokens in the pool | 52,311 | 200,084 |

Each column sums to the memory free at start. About 0.7 GiB of the 22.5 is in use before SGLang loads anything (computed). The pool step takes 2.14 GiB <!-- calc: 9.32 - 7.18 = 2.14 --> (bf16) and 2.05 GiB <!-- calc: 15.79 - 13.74 = 2.05 --> (FP8) beyond K and V; the log does not say for what. The bf16 baseline left 3.82 GiB unused at the end <!-- src: results/g2-baseline-qwen3-4b/20260927-151950/server.log -->; the FP8 configuration left 0.71 GiB.

### 4.2 How the pool grew

The pool grew from 52,311 to about 200,000 tokens, 3.8 times <!-- calc: 200084 / 52311 = 3.8 -->. A feasibility test with one or two requests shows the steps. FP8 weights gave 77,171 tokens, and an FP8 cache on top gave 154,343, twice that and 2.95 times the bf16 pool <!-- src: report/chapters/05-single-gpu-optimisation.tex -->. Runs with the final flags then logged 200,067 and 200,084 tokens.

The last step from 154,343 tokens is not explained by any measurement. Our reading, not tested: after the pool step the bf16 log with a 4,096-token chunk still had 4.76 GiB free <!-- src: results/g2-baseline-qwen3-4b/20260927-151950/server.log -->, the FP8 log with a 256-token chunk only 1.73 GiB <!-- calc: 17.52 - 15.79 = 1.73 -->, so a smaller chunk seems to let SGLang reserve less working memory and give more to the pool.

The final configuration left the memory fraction to SGLang, and we did not record the value it chose. Our paper model assumes 90 % of memory for weights and cache and predicts 238,410 tokens, 19 % more than the engine allocated <!-- src: report/chapters/04-performance-model.tex -->.

### 4.3 How full the pool gets

A pool of 200,000 tokens holds 95 requests of the mean size (2,100 tokens). At 225 users the server never ran more than 9 requests at once. Peak use was 11 % of the pool, about 22,000 tokens.

## 5. Concept: from requests to users

### 5.1 Two latencies and a pass rule

A request counts when two latencies stay inside a limit: the time to the first token (TTFT, mostly prefill of the prompt) and the time per output token (TPOT, decode). We use three tiers; rag and code prompts are long, so they get twice the TTFT limit.

| tier | TTFT chat | TTFT rag, code | TPOT |
|---|---|---|---|
| strict | 0.5 s | 1.0 s | 30 ms |
| standard | 1.0 s | 2.0 s | 50 ms |
| relaxed | 2.0 s | 4.0 s | 100 ms |

Attainment is the share of all requests, failures included, that meet both limits of a tier. A load level passes when attainment is at least 0.90; with three seeds (three different request streams), mean minus sd must reach 0.90.

Round numbers show where the time goes. Decode reads all weights once per step, so 8 GB at 300 GB/s costs at least 26.7 ms per token <!-- calc: 8 / 300 * 1000 = 26.7 --> and 4 GB costs 13.3 ms. Prefill on an L4 costs about 0.2 ms per prompt token, so a 1,000-token prompt needs about 0.2 s and a 5,000-token prompt about 1 s, the whole standard TTFT budget of a chat request (computed).

Measured, the bf16 decode step with one request took 33.9 ms against a roofline floor of 26.8 ms: the engine reached about 79 % of peak bandwidth. The engine also does not run a long prefill beside the decodes for free. With the default chunk SGLang put up to 4,096 prompt tokens into one step, so a 1,000-token prompt paused every running decode, and the client saw an inter-token gap p99 of about 230 ms against a median of 41 ms. Figure 2 sketches it.

```
 time ──────────────────────────────────────────────────────────►
 decode A   ■■■■■■ ░░░░░░░░░░░░ ■■■■■■■■      ░ = waiting while
 decode B   ■■■■■■ ░░░░░░░░░░░░ ■■■■■■■■        a new prompt
 new prompt        ▓▓▓▓▓▓▓▓▓▓▓▓ ■■■■■■■■        is prefilled (▓)
 short chat        queued ░░░░░░░░░ first token late
```

*Figure 2. One prefill stalls the running decodes and the requests behind it.*

### 5.2 Users and Little's law

A user is one closed loop: send a turn, wait for the whole streamed answer (response time R), think for a time Z, send the next turn. Little's law links users U to requests in flight C:

```
 U = C x (R + Z) / R

 C = 4 in flight, R = 2 s, Z = 100 s  ->  U = 4 x 102 / 2 = 204
 C = 4 in flight, R = 2 s, Z =  10 s  ->  U = 4 x  12 / 2 =  24
```

The same GPU, holding the same 4 requests, serves 204 or 24 users <!-- calc: 4 * (2 + 100) / 2 = 204 --> depending on how long people think (hypothetical numbers). A user count without its think time says little.

### 5.3 How we measure users

No standard benchmark tool runs closed-loop users with think time and scores SLO tiers, so a custom script is needed. Ours follows this loop:

```python
async def user(server, think_time, record):
    await sleep(uniform(0, think_time.sample()))   # staggered start
    history = []
    while not stopped:
        prompt = history + [next_turn()]           # whole chat so far
        t_send = now()
        first, last, n_tokens = None, None, 0
        async for token in server.stream(prompt):
            first = first or now()
            last, n_tokens = now(), n_tokens + 1
        ttft = first - t_send
        tpot = (last - first) / max(n_tokens - 1, 1)
        record(t_send, request_class, ttft, tpot, failed=first is None)
        history = prompt + [answer]
        await sleep(think_time.sample())           # lognormal, cut at 3600 s

def attainment(records, tier, warmup_s, window_s):
    end = warmup_s + window_s
    window = [r for r in records if warmup_s <= r.t_send < end]
    ok = [r for r in window if not r.failed
          and r.ttft <= tier.ttft[r.request_class] and r.tpot <= tier.tpot]
    return len(ok) / len(window)       # failures count as misses
```

Staggered starts matter: a first version started all users at once and, for a 0.6B model, found 30, 56 and 68 users per tier against 104, 136 and 176 after the fix. We score only requests sent in a window of at least 600 s after a warm-up, 300 to 1,400 requests per level on one L4.

## 6. Worked case: the users of one L4

### 6.1 The first baseline: 16 users

The first baseline ran bf16 on SGLang with Triton attention and PyTorch sampling, on a synthetic load: 1,000 prompt tokens, 250 output tokens, one turn per user, Z = 30 s. It served 0 users at strict, because one request alone has a TPOT of about 31 ms against a 30 ms limit. It served 16 at standard: 97 % at 16 users and 70 % at 17. A paper model had expected 25, 140 and 203.

The relaxed figure exists in two versions. Our first write-up reports 30 users. The level at 30 users scores 0.897, which that write-up rounded to 90 %; at three decimals it misses the 0.90 rule, and the last passing level is 28 users with 0.948 <!-- src: report/chapters/05-single-gpu-optimisation.tex -->. We use 28. The standard figure, 16, is the same in both readings (0.966 at 16, 0.699 at 17 <!-- src: report/chapters/05-single-gpu-optimisation.tex -->).

### 6.2 The final configuration: about 225 users

The final configuration is SGLang with FP8 weights, FP8 KV cache, chunked prefill of 256, FlashInfer and mixed chunks. The workload is our assistant mix: multi-turn chat, rag and code with lengths taken from public traces. The think time is a truncated lognormal fitted to request gaps in a public trace: median 116 s (the raw trace median is 103 s), mean 351.5 s, cut at 3,600 s. Each level ran 10 minutes.

| U | seeds | strict | standard | relaxed |
|---|---|---|---|---|
| 225 | 1 | 0.717 | 0.956 | 1.000 |
| 225 | 3 | 0.647 ± 0.008 | 0.906 ± 0.017 | 0.986 ± 0.012 |
| 260 | 3 | 0.599 ± 0.009 | 0.886 ± 0.021 | 0.973 ± 0.020 |
| 560 | 3 | 0.186 ± 0.056 | 0.506 ± 0.149 | 0.804 ± 0.125 |

At 225 users the standard mean is 0.906, but mean minus sd is 0.889, just under the rule, so we call 225 borderline. At 260 users standard fails with 0.886 ± 0.021. The edge lies between the two; a planned level at 240 was lost when the run was cancelled after its three seeds at 225. Relaxed holds at 260 and fails at 560. Strict never passes: 0.60 at 260, and 0.752 at 150 users, the lowest level we ran.

### 6.3 From 16 to 225 is a change of workload

Same GPU and model. Five things changed: the precision (bf16 to FP8), the engine flags, the prompts (a fixed 1,000 tokens to a mix with a mean of 2,004), the answers (250 tokens to a mean of 96), and the mean think time (30 s to 351.5 s). With Z = 30 s one request in flight stood for 16 / 4.5 = 3.6 users <!-- calc: 16 / 4.5 = 3.6 -->; with Z = 351.5 s, for about 225 / 2 = 112.

```
 baseline, synthetic   16 users x R 11 s / (11 s + Z 30 s) = 4.3 in flight
                       measured                              4.5 in flight
 final, assistant mix  225 users, Z mean 351.5 s           ~2 in flight
                       measured                             1.7-2.2 in flight
```

*Figure 3. Requests in flight at each edge (Little's law and measured).*

Little's law splits that factor of about 30 into its two parts (computed). Users per request in flight are (R + Z) / R. The baseline had R = 11 s and Z = 30 s, so 3.7 <!-- calc: (11 + 30) / 11 = 3.7 -->. At the final edge, 2 requests in flight give R = 2 x 351.5 / (225 - 2) = 3.2 s <!-- calc: 2 * 351.5 / 223 = 3.2 -->, so about 112. Changing Z alone at R = 11 s gives 33, a factor of 8.9 <!-- calc: (11 + 351.5) / 11 / 3.7 = 8.9 -->; changing R alone at Z = 30 s gives 10.4 <!-- calc: (3.2 + 30) / 3.2 = 10.4 -->, a factor of 2.8 <!-- calc: 10.4 / 3.7 = 2.8 -->. The two do not multiply exactly, so depending on the order the think time accounts for about 9-11 times and the shorter response time for about 3 times. FP8, chunked prefill and the shorter answers all shortened R, and this pair of runs cannot separate them. So 225 / 16 = 14 times more users does not mean the L4 got 14 times faster: at its edge it carried about 2 requests at a time, fewer than the 16-user GPU.

### 6.4 The missing row: bf16 on the assistant mix

We have no verified bf16 number on the assistant mix, which would split the gain cleanly. A search over requests in flight with no think time found that bf16 passes standard up to C = 3, which Little's law turns into about 201 users (214 with FlashInfer and mixed chunks). That is an estimate. The one run that put real users on bf16, at U = 214, scored 0.416 at standard but did not reach steady state: think times were not truncated and all users started fresh, a load-generator bug fixed later. It was never re-run, so any "FP8 gave X more users" claim here rests on estimates.

### 6.5 What sets the edge at 225

At 225 users SGLang produced 52 output tok/s at a mean utilisation of 78 %, and output grew roughly in proportion to users up to 600 users (154 tok/s, where standard had fallen to 0.521). A best-case test is a different setup (prompts of 100-200 tokens, 256 output tokens, no think time, one seed), so it bounds the engine rather than our workload: there SGLang peaked at 1,752.6 tok/s with 128 streams (its 64-stream level was anomalous, below the 32-stream one) and vLLM at 2,570.

The misses at the edge are first-token misses. In a single-seed run at 225 users, 13 of the 15 standard misses were TTFT-only, and 9 of the 15 came from prompts of 4k tokens or more. In the three-seed run, standard attainment was 0.92 for prompts under 1k tokens, 0.94 for 1-3k and 0.79 for 3k or more. When no long prefill was pending, only about 2 % of requests missed even with several in flight, against 16-58 % when one was pending. That link is a correlation; no run isolated it, so the head-of-line picture of Figure 2 is our reading of the evidence.

Strict fails for both reasons at once. The 4k+ prompts (13 % of requests) need 0.83-1.36 s of TTFT on an empty L4, above even the 1.0 s strict limit for rag and code, and under load the TPOT p90 is 32-35 ms against a 30 ms limit.

The price is an assumption. At 0.80 USD per L4-hour (the GPU alone, a list price) one L4 serves 281 users per USD per hour; at about 1.1 USD (including the container's CPU and memory) about 205.

## 7. Limits

- The edge rests on 3 seeds at 225 and 260 users, and an sd from 3 seeds is itself uncertain. U=240 was never measured.
- The bf16 baseline is one seed on a synthetic workload with an older load generator, and no verified bf16 result exists on the assistant mix.
- Every user count depends on the think-time model; no trace records think time, so it is fitted from gaps between requests.
- The automatic memory fraction was not recorded, the 2 GiB of the pool step beyond K and V is not named in the log, and the step from 154,343 to about 200,000 tokens is only our reading.
- The three-seed runs ran on two platforms (Lightning, Modal). Parity was checked with two fixed-concurrency probes (TPOT 33.6 against 33.9 ms at C = 1, 41.1 against 41.1 ms at C = 4), not with a load run.

## 8. Reproduce

Final edge: run 24a, plan `config/plans/one-l4-edge-seeds.yaml` (3 seeds at U=225; U=240 was cut), about 40 minutes of one L4, about $0.7 (estimate, CHANGELOG Step 98).

```bash
make dry PLAN=one-l4-edge-seeds SESSION_NO=24a          # free rehearsal on the fake engine
python scripts/vendors/modal/cli.py session --plan one-l4-edge-seeds --session 24a --gpu L4 --hours 1.6
```

bf16 baseline: `results/g2-baseline-qwen3-4b/20260927-151950`, about 98 minutes of L4 for the whole session (first run with an older entry point, `python -m bench.run`).

```bash
make run EXP=config/experiments/g2-baseline-qwen3-4b.yaml
make predict ARGS="--model qwen3-4b-fp8 --kv-dtype fp8"       # paper model, CPU only
python scripts/analysis/slo_table.py                            # SLO table from levels/*.json, CPU only
```

FP8 memory log: `results/runs/20261023-1225_session29a_one-l4-hicache-radix/validate/server.log` (same flags as the final configuration plus `--enable-cache-report`; `nvidia-smi.txt` there gives 23,034 MiB). Other run folders: `results/runs/20261011-1753_session8a_validate-u-chunk256` (1 seed at U=225, misses by type), `results/runs/20261012-0003_session12a_final-l4-sglang` (U=260 and 560), `results/runs/20261008-2029_session3_backends` (bf16 on the assistant mix, U=214), `results/explore/20260927-1142_spike_NVIDIA-L4` (pool sizes). The load generator and the SLO tiers are in `src/measure/` and `config/slo.yaml`.

## 9. Sources

- `docs/reports/results-slo-table.md`: rows 3 (U=214), 8a, 12a, 24a.
- `docs/reports/final-capacity-summary.md`: edge per layout, users per $/h at 1.1 USD.
- Server logs of the bf16 baseline and of run 29a: every memory figure of Section 4.1.
- Note 04: bf16 baseline, decode step against the roofline, in-flight count, inter-token gaps, the 30-user relaxed figure.
- Note 06: Modal and Lightning parity probes.
- Note 11: misses by type and prompt length, GPU utilisation and tok/s, strict tier.
- Note 13 and note 20: think time, trace median 103 s, fitted median 116 s, mean 351 s.
- Note 15: run 12a with error bars, prefill cost per token.
- Note 21: best-case throughput.
- Note 26, "Memory split": the memory-fraction rule and the ~22.5 GiB usable.
- CHANGELOG Steps 5 (staggered starts), 6, 7, 12 (bf16 on the assistant mix, U=214), 98 (24a), 103 and 108 (three models on one L4), 115 (24a by prompt length, in flight, KV peak), 164 (0.80 USD per L4-hour, 281 users per $/h).
- Report chapters 1, 4, 5 and 9: pool of run 24a (200,067 tokens, peak 9 running), the 28-user relaxed reading, pool steps of the feasibility test, the memory-fraction probe (0.8, 0.85), the paper-model pool, the price assumptions.

> **Học nhanh**
>
> - Một L4 dùng được khoảng 22.5 GiB; FP8 weights chiếm 4.30 GiB.
> - Mỗi token KV tốn 72 KiB (FP8), pool chứa khoảng 200,000 token.
> - Ở 225 users, pool chỉ dùng 11 % lúc cao nhất.
> - Giới hạn là thời gian tới token đầu: prompt từ 3k token chỉ đạt 0.79.
> - Baseline bf16 phục vụ 16 users với think time 30 s, không so thẳng với 225 được.
> - Chưa có kết quả bf16 đáng tin trên assistant mix (lần chạy U=214 không ổn định).

Written with Claude Code. Numbers checked against the runs under Sources.
