---
title: "KV cache and paged attention"
description: "Why one Qwen3-4B token costs 72 KiB of GPU memory, why about 200,000 of them fit on one L4, how paged attention lays them out, and what a bigger cache did and did not change."
pubDatetime: 2026-10-25T00:00:00Z
kind: concept
series: concepts
part: 1
project: llm-serving-bench
tags: [kv-cache, paged-attention, prefix-cache, offload, l4, sglang, vllm]
---

Take one chat request of 2,100 tokens (2,004 prompt, 96 answer) served by Qwen3-4B on one NVIDIA L4, a 24 GB GPU. By the end of its answer the GPU holds about 155 MB of cached keys and values for it, with an FP8 cache. The engine we used set aside room for 200,067 such tokens, so about 95 requests of this size fit at once. Below we derive those numbers and test what a bigger cache changed. <!-- src: report/chapters/04-performance-model.tex --> <!-- calc: 200067 / 2100 = 95 -->

**Contents**

1. What the KV cache is: why decode needs it, bytes per token, tokens per pool
2. Paged attention: slots, blocks, block tables, an allocator, prefix sharing
3. Worked case on one L4: pool size, prefix cache, offload to host RAM, how we measured hits
4. Limits
5. Reproduce
6. Sources

## 1. What the KV cache is

### 1.1 Why decode needs it

A decoder model generates one token per step. At each step, attention compares the new token's query with the keys of every earlier token and mixes their values. Those keys and values do not change once computed, so the engine stores them: that store is the **KV cache**. With it, a decode step computes K and V for one new token and reads the rest from memory.

```
 prefill (once)         decode step 1        decode step 2
 prompt t0..t2003  -->  t2004               t2005
 write K,V for 2,004    write K,V for 1     write K,V for 1
                        read  K,V of 2,004  read  K,V of 2,005
```

On our L4 the prefill of a 2,004-token prompt took a measured 0.395 s and one decode step took 21.6 ms. Recomputing the prompt at every step would cost roughly 18 decode steps' worth of time per token. <!-- src: report/chapters/02-background.tex --> <!-- calc: 0.395 / 0.0216 = 18 -->

The cache costs memory and bandwidth. Every decode step reads the cache of every running request as well as the weights. For one stream, reading 4 GB of FP8 weights over the L4's 300 GB/s caps decode at about 75 tokens per second; we measured 43 to 46. We attribute the gap to KV reads and kernel overhead, without having profiled it.

### 1.2 Bytes per token

Per token, the cache holds one key and one value vector per layer and per KV head:

```
 bytes/token = 2 (K and V) x layers x kv_heads x head_dim x bytes_per_elem
```

A short function computes it from a Hugging Face `config.json`:

```python
def kv_bytes_per_token(cfg: dict, bytes_per_elem: int) -> int:
    """K and V, every layer, every KV head (full attention only)."""
    head_dim = (cfg.get("head_dim")
                or cfg["hidden_size"] // cfg["num_attention_heads"])
    return (2 * cfg["num_hidden_layers"] * cfg["num_key_value_heads"]
            * head_dim * bytes_per_elem)

def tokens_in_pool(pool_bytes: float, cfg: dict, bytes_per_elem: int) -> int:
    return int(pool_bytes // kv_bytes_per_token(cfg, bytes_per_elem))

qwen3_4b = {"num_hidden_layers": 36, "num_key_value_heads": 8, "head_dim": 128}
print(kv_bytes_per_token(qwen3_4b, 2))     # bf16: 147456
print(kv_bytes_per_token(qwen3_4b, 1))     # FP8:  73728
```

For Qwen3-4B (36 layers, 8 KV heads, head dimension 128), both values are computed from the model config, and the engine logs confirm them (below the table):

| cache dtype | arithmetic | bytes per token |
|---|---|---|
| bf16, 2 bytes | 2 x 36 x 8 x 128 x 2 = 147,456 | 144 KiB (computed) |
| FP8, 1 byte | 2 x 36 x 8 x 128 x 1 = 73,728 | 72 KiB (computed) |
<!-- calc: 2 * 36 * 8 * 128 * 2 / 1024 = 144 -->
<!-- calc: 2 * 36 * 8 * 128 * 1 / 1024 = 72 -->

SGLang prints the K and V sizes when it allocates the pool, in GiB although the log says "GB". With an FP8 cache it logged 200,084 tokens with K 6.87 and V 6.87 GiB, which is 200,084 x 73,728 bytes. With a bf16 cache it logged 52,311 tokens with K 3.59 and V 3.59 GiB, which is 52,311 x 147,456 bytes. <!-- calc: 200084 * 73728 / 2 / 2**30 = 6.87 --> <!-- calc: 52311 * 147456 / 2 / 2**30 = 3.59 -->

Our 2,100-token request therefore ends at 2,100 x 73,728 bytes, about 155 MB in FP8, or 310 MB in bf16 (computed). Each decode step adds one token's 72 KiB, which is 0.05 % of what the prefill wrote. <!-- src: report/chapters/02-background.tex --> <!-- calc: 2100 * 73728 / 10**6 = 155 -->

### 1.3 Tokens per pool

At startup the engine loads the weights, reserves working memory, and turns most of what is left into a **KV pool**: a fixed number of token slots shared by all requests. With round numbers first: if 10 GB were left for KV, an FP8 cache of 72 KiB per token would give 10 x 10^9 / 73,728 = 135,634 tokens (hypothetical). <!-- calc: 10 * 10**9 / 73728 = 135634 -->

The real pools come from the server logs, so the token counts below are measured. All four rows are SGLang on one L4.

| weights | KV cache | KV pool, tokens |
|---|---|---|
| bf16, 7.71 GiB (log) <!-- src: report/chapters/05-single-gpu-optimisation.tex --> | bf16 | 52,311 |
| FP8, 4.30 GiB (log) | bf16 | 77,171 |
| FP8 | FP8 | 154,343 |
| FP8, 4.0 GB (modelled), final config, chunk 256 | FP8 | 200,067 |
<!-- src: report/chapters/05-single-gpu-optimisation.tex, report/chapters/04-performance-model.tex -->

FP8 weights freed about 3.4 GiB and added about 25,000 tokens. Halving the bytes per token then gave 154,343 tokens, 2.95 times the bf16 pool. The final pool is 200,067 x 73,728 bytes, 14.8 GB of the 24 GB card (computed from the logged count). <!-- calc: 7.71 - 4.30 = 3.4 --> <!-- src: report/chapters/05-single-gpu-optimisation.tex, report/chapters/04-performance-model.tex, report/chapters/07-kv-cache-frameworks-offloading.tex -->

## 2. Paged attention

### 2.1 One slot per request

Early engines gave each request one contiguous slot sized for the longest answer it might produce. Assume a slot of 8,192 tokens, a round value. Our 2,100-token request leaves (8,192 - 2,100) / 8,192 = 74 % of its slot reserved and unused, and no other request can use it. <!-- src: report/chapters/02-background.tex -->

```
 contiguous slots, each sized for the longest possible answer

 |AAAAAAA.....................|BBB.........................|CC..
  ^used  ^reserved, unused     ^used                        ^ next slot
                                                              must fit
                                                              whole
```

Two more losses follow. A slot sized for the maximum keeps its unused end even when the answer stops early, and the gaps between slots of different sizes are too small for anyone. Two requests with the same opening tokens also store those tokens twice.

### 2.2 Blocks and a block table

PagedAttention (Kwon et al., 2023) applies virtual memory to the KV cache. The pool is cut into fixed-size **blocks**. Each request owns a **block table** that maps its logical blocks, in order, to physical blocks anywhere in the pool. The attention kernel reads K and V through that table.

A worked case with round numbers: 16 tokens per block and a tiny pool of 8 physical blocks, P0 to P7. Sixteen is vLLM's default block size; we checked it in the v0.32.0 source, while our vLLM runs used 0.30.0.

```
 step 1: empty pool
   pool   [P0 ][P1 ][P2 ][P3 ][P4 ][P5 ][P6 ][P7 ]   free: 8

 step 2: request A prefills 40 tokens -> ceil(40/16) = 3 blocks
   pool   [A0 ][P1 ][A1 ][P3 ][P4 ][A2 ][P6 ][P7 ]   free: 5
   table A: logical 0 1 2 -> physical P0 P2 P5
   A2 holds 8 tokens, 8 slots still empty

 step 3: request B prefills 20 tokens -> 2 blocks
   pool   [A0 ][B0 ][A1 ][P3 ][P4 ][A2 ][B1 ][P7 ]   free: 3
   table B: logical 0 1 -> physical P1 P6

 step 4: A decodes 9 tokens -> token 49 crosses into a 4th block
   pool   [A0 ][B0 ][A1 ][A3 ][P4 ][A2 ][B1 ][P7 ]   free: 2
   table A: P0 P2 P5 P3

 step 5: B finishes -> its blocks go back to the free list
   pool   [A0 ][P1 ][A1 ][A3 ][P4 ][A2 ][P6 ][P7 ]   free: 4
```

Blocks need not be adjacent, so nothing is lost to gaps. A request takes a new block only when it crosses a block boundary, so at most 15 slots per request sit empty. For our 2,100-token request, ceil(2,100 / 16) = 132 blocks hold 2,112 slots, and 12 are empty, 0.6 % (computed). One block of Qwen3-4B with an FP8 cache is 16 x 72 KiB = 1,152 KiB (computed). <!-- src: report/chapters/02-background.tex --> <!-- calc: 16 * 72 = 1152 -->

The paper reports 2 to 4 times the throughput of FasterTransformer and Orca at the same latency, on its own hardware and models. We did not reproduce that comparison.

### 2.3 An allocator in pseudocode

The bookkeeping fits in a few lines. This is a sketch of the idea; real engines add preemption policies, reference counts and eviction.

```python
BLOCK = 16                          # tokens per block
free = list(range(NUM_BLOCKS))      # physical block ids
table = {}                          # request id -> [physical block ids]

def append_token(req, pos):         # pos = 0-based token position
    if pos % BLOCK == 0:            # first token of a new logical block
        if not free:
            return preempt_or_queue(req)
        table.setdefault(req, []).append(free.pop())
    phys = table[req][pos // BLOCK]
    write_kv(phys, pos % BLOCK)     # one K and one V per layer and head

def finish(req):
    free.extend(table.pop(req))     # blocks return to the pool
```

### 2.4 Sharing a prefix

With a table in front of the blocks, two requests that start with the same tokens can point at the same physical block. vLLM and TensorRT-LLM key each block by a hash of all the tokens up to and including it; SGLang keeps a token-level radix tree instead.

```
 key(block i) = hash(key(block i-1), tokens of block i)

 request A   logical 0 1 2   -> physical P0 P5 P2
 request B   logical 0 1     -> physical P0 P7     P0 stored once,
                                                   refcount 2
```

Block P0 is shared: A and B start with the same tokens, so B skips that prefill. A multi-turn chat works the same way, because turn 2 re-sends turn 1:

```
 turn 1, 40 tokens:              [k0][k1][k2']     k2' = partial block,
 turn 2 = turn 1 + new message:  [k0][k1][k2 ][k3]       not cached
                                  ^^^^^^^^ hit: 32 tokens skip prefill
```

vLLM caches only full blocks, so in this example the third block of turn 1 (8 tokens) is recomputed. Freed blocks stay in the index until the engine needs the space, which lets a user who comes back later still hit them.

## 3. Worked case: one L4

### 3.1 The pool was never the limit

At 225 users, the capacity edge of our final configuration, the server log showed at most 9 requests running and peak KV use of 11 % of the pool, about 22,000 tokens. Standard attainment there was 0.906 ± 0.017 over 3 seeds. The pool had room for about 95 mean requests and held far fewer; our reading of the logs is that prefill compute was the limit on 1 x L4.

A small pool does hurt. When we co-hosted three models on one L4, the LLM's pool shrank to about 28,800 tokens, the log showed 98 % in use with up to 11 requests queued, and standard attainment fell to 0.508 ± 0.028 (3 seeds). That run could not separate KV pressure from the GPU time the vision model took. <!-- src: report/chapters/08-serving-system.tex -->

### 3.2 The prefix cache helped at a 15 % hit rate

Our load generator re-sends the whole conversation on every chat turn, so 48 to 59 % of prompt tokens repeat that session's earlier tokens, and only 0.2 to 1.0 % come from other sessions. At U = 498 (10 minutes, one seed each) we ran SGLang's radix cache on and off. With it on, 14.9 % of prompt tokens were hits, and standard attainment rose from 0.695 to 0.777, 8.2 points.

Why so low? Our reading comes from a CPU simulation of the same request stream with the final configuration's pool of 199,770 tokens: at 520 users that pool holds about 2 minutes of new KV traffic, while a user's think time has a median of 116 s and a mean of 351 s, so many histories are evicted before their owner returns. The on/off run had a smaller pool still, 154,343 tokens.

### 3.3 Offload to host RAM

A second tier keeps evicted blocks in host RAM and copies them back over PCIe on a hit. The same simulation gave a ratio rule: a host pool helps only when it is several times the GPU pool. Our first test broke the rule. An 8 GB host pool holds 108,506 tokens, 0.70 times the 154,343-token GPU pool of the on/off run, and it gave a 14.6 % hit against 14.9 % without it. <!-- src: report/chapters/07-kv-cache-frameworks-offloading.tex --> <!-- calc: 108506 / 154343 = 0.70 -->

A 64 GB host pool is 4.34 times the 200,084-token GPU pool of our later SGLang run. SGLang's log printed "Allocating kv hierarchical KV host pool: 868056 tokens, 64.00 GB host memory", and 64 x 10^9 / 73,728 = 868,056 tokens, so the engine's count agrees with the computed 72 KiB per token. <!-- calc: 64 * 10**9 / 73728 = 868056 --> <!-- src: report/chapters/07-kv-cache-frameworks-offloading.tex -->

The generic flags look like this (vLLM 0.30.0 and SGLang 0.5.20 in our runs; check `--help` of your version):

```bash
# vLLM: FP8 KV, prefix caching (on by default), 64 GiB host tier, report cached tokens
vllm serve Qwen/Qwen3-4B-Instruct-2507-FP8 \
  --kv-cache-dtype fp8_e4m3 --enable-prefix-caching \
  --kv-offloading-size 64 --kv-offloading-backend native \
  --enable-prompt-tokens-details

# SGLang: radix cache on by default; 64 GB host tier, write-through
python -m sglang.launch_server --model-path Qwen/Qwen3-4B-Instruct-2507-FP8 \
  --kv-cache-dtype fp8_e4m3 \
  --enable-hierarchical-cache --hicache-size 64 \
  --hicache-write-policy write_through \
  --enable-cache-report
```

We ran each engine with and without a host tier on one L4 (64 GB on SGLang, 64 GiB on vLLM), FP8 cache, 20-minute warm-up, 10-minute window, one seed per cell. The engines differ, and so do their baselines at U = 520, so read each row against its own baseline only.

| engine, U | prefix hit | standard | strict |
|---|---|---|---|
| SGLang host tier, U = 260 | 23.1 % -> 34.6 % | 0.914 -> 0.927 | - |
| SGLang host tier, U = 520 | 16.0 % -> 29.2 % | 0.582 -> 0.770 | - |
| vLLM host tier, U = 320 <!-- calc: 0.233 * 100 = 23.3 --> <!-- calc: 0.348 * 100 = 34.8 --> | 23.3 % -> 34.8 % | 0.904 -> 0.915 | 0.575 -> 0.603 |
| vLLM host tier, U = 520 <!-- calc: 0.162 * 100 = 16.2 --> <!-- calc: 0.289 * 100 = 28.9 --> | 16.2 % -> 28.9 % | 0.783 -> 0.799 | 0.294 -> 0.304 |

The hit rate rose by 11.5 to 13.2 points in every row. The simulation had predicted 23 -> 36 % and 16 % less prefill work for SGLang at 260 users; we measured 23.1 -> 34.6 % and 15 % less (prefill busy 0.210 -> 0.179), so the prediction held for this one seed. Prefill busy is itself modelled: (prompt tokens - cached tokens) x 0.2 ms per token, summed over the window, from measured counts.

Attainment did not move reliably. On vLLM every change sits inside the 0.02 to 0.05 noise of a single L4 run, so we claim nothing. On SGLang, standard attainment at U = 520 rose by 0.19 with one seed; it needs 3 seeds before we treat it as real. Our reading for vLLM is that the prefill saved was small next to queueing at that load. The simulation adds one structural reason: at 520 users, 45 % of the prompts of 3,000 tokens or more are first turns (mostly rag and code), and no cache can serve a first turn.

### 3.4 How we measured the hit rate

Both engines return `usage.prompt_tokens_details.cached_tokens` per request once the flags above are set (and the client asks for usage in the stream). The hit rate is a token-weighted share; a custom script is needed to collect it under load:

```python
cached = prompt = 0
for rec in records:                       # one record per finished request
    if rec.cached_tokens is None or rec.prompt_tokens == 0:
        continue                          # engine did not report it
    cached += rec.cached_tokens
    prompt += rec.prompt_tokens
prefix_hit = cached / prompt if prompt else None
```

For vLLM's host tier we checked that tokens loaded back from host RAM are included in `cached_tokens`; the server log printed "External prefix cache hit rate 13.8 %" in the U = 320 run.

## 4. Limits

- Bytes per token (144 KiB and 72 KiB) are computed from the model config. The 64 GB host-pool count agrees with 72 KiB; on the GPU side we have only the 14.8 GB computed from the logged token count.
- Every offload number comes from one seed per cell, and the SGLang gain at U = 520 is unconfirmed.
- The SGLang and vLLM offload runs differ in engine, version and baseline, so the table does not rank them.
- The hit rates depend on our synthetic generator: no shared system prompt, no shared RAG documents, random corpus offsets. A workload with a long shared system prompt would see more cross-user hits.
- We did not profile the attention kernels. The block and hashing details come from the PagedAttention paper and the framework docs as we read them.
- The 74 % waste and the 8-block pool are round examples, not any engine's setting.

## 5. Reproduce

The arithmetic runs on a laptop:

```bash
python -c "print(2*36*8*128*2, 2*36*8*128*1)"          # 147456 73728
python -c "print(200067/2100, 64e9/73728, 8e9/73728)"    # 95.3, 868055.6, 108506.9
make predict ARGS="--model qwen3-4b-fp8 --kv-dtype fp8"  # paper model, same KV bytes
make kv-reuse                                            # offload simulation, CPU, ~11 min
```

GPU runs, all 1 x L4 on Modal: sessions 4 (radix on, off, HiCache 8 GB), 24a (pool usage), 29a and 29b (SGLang radix against HiCache 64 GB, about 3.5 USD estimated), 32a and 32b, 33a and 33b (vLLM offload, about 2 USD per pair, estimated). Runbook: `docs/ops/plans/hicache-offload.md`.

## 6. Sources

- CHANGELOG Step 158 (HiCache 64 GB), Step 169 and Step 170 (vLLM offload at U = 320 and 520).
- `docs/notes/07` §4 (radix cache on and off, HiCache 8 GB), `docs/notes/20` (reuse structure, offload simulation, ratio rule), `docs/notes/21` (single-stream ceiling), `docs/notes/26` (three models on one L4), `docs/notes/32` §4 (pool and usage of run 24a), `docs/notes/41` §1, §3.1 (paged blocks, prefix keys, vLLM block size 16).
- Report Chapters 2, 4, 5, 7 and 8 (`report/chapters/`).
- Code: `config/kv_reuse.yaml:4`, `src/predict/domain/model_spec.py:55`, `src/measure/domain/metrics.py:53` (prefix hit), `config/experiments/hicache-64-l4.yaml`, `config/plans/one-l4-vllm-offload-64.yaml`.
- Runs: `results/runs/20261009-1254_session4_quant-cache`, `results/runs/20261014-2347_session24a_one-l4-edge-seeds`, `20261023-1225_session29a_one-l4-hicache-radix`, `20261023-1225_session29b_one-l4-hicache-64` (not committed, raw output on the outputs repository only); sessions 32a, 32b, 33a, 33b on the outputs repository.
- Kwon et al., "Efficient Memory Management for Large Language Model Serving with PagedAttention", https://arxiv.org/abs/2309.06180.

> **Học nhanh**
>
> - Mỗi token của Qwen3-4B cần 72 KiB KV khi lưu FP8, 144 KiB khi lưu bf16 (số tính từ cấu hình, không đo).
> - Một L4 giữ được khoảng 200,067 token KV, tức khoảng 95 yêu cầu cỡ trung bình 2,100 token.
> - Cấp ô liền khối 8,192 token cho yêu cầu 2,100 token thì bỏ phí 74 %; chia khối 16 token chỉ phí 0.6 %.
> - Ở 225 users, server chỉ dùng 11 % pool KV: giới hạn là prefill, không phải bộ nhớ.
> - Prefix cache chỉ trúng 14.9 % nhưng vẫn tăng standard từ 0.695 lên 0.777 (+8.2 điểm).
> - Offload khoảng 64 GB sang RAM host tăng tỷ lệ trúng 11.5 đến 13.2 điểm, nhưng SLO của vLLM vẫn nằm trong nhiễu.

Written with Claude Code. Numbers checked against the runs under Sources.
