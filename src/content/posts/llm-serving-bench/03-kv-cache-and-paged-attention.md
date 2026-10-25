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

Take one chat request of 2,100 tokens (2,004 prompt, 96 answer) served by Qwen3-4B on one NVIDIA L4, a 24 GB GPU. By the end of its answer the GPU holds about 155 MB of cached keys and values for it, with an FP8 cache. Below we derive that number, show how engines lay it out, and report what a bigger cache changed.

## Key results

| what | number | kind |
|---|---|---|
| KV cache per token, Qwen3-4B | 144 KiB bf16, 72 KiB FP8 | computed |
| KV pool on one L4, final config | 200,067 tokens, about 95 requests of 2,100 tokens | measured; 95 computed |
| peak pool use at 225 users | 11 % | measured |
| empty space, 2,100-token request | 74 % in an 8,192-token slot, 0.6 % in 16-token blocks | computed |
| prefix cache on, U = 498 | 14.9 % of prompt tokens hit, standard 0.695 -> 0.777 | measured, 1 seed |
| host-RAM tier of about 64 GB | hit rate +11.5 to +13.2 points, attainment gain not confirmed | measured, 1 seed |


## 1. Bytes per token

Each decode step's attention reads the keys and values of every earlier token. They never change, so the engine stores them: the **KV cache**. On our L4 the prefill of a 2,004-token prompt took 0.395 s and one decode step 21.6 ms (measured), so recomputing the prompt at each step would cost about 18 decode steps per token.

Per token it holds one key and one value vector per layer and KV head:

```python
def kv_bytes_per_token(cfg: dict, bytes_per_elem: int) -> int:
    """K and V, every layer, every KV head (full attention only)."""
    head_dim = cfg.get("head_dim") or cfg["hidden_size"] // cfg["num_attention_heads"]
    return 2 * cfg["num_hidden_layers"] * cfg["num_key_value_heads"] * head_dim * bytes_per_elem

qwen3_4b = {"num_hidden_layers": 36, "num_key_value_heads": 8, "head_dim": 128}
print(kv_bytes_per_token(qwen3_4b, 2))   # bf16: 147456 bytes = 144 KiB
print(kv_bytes_per_token(qwen3_4b, 1))   # FP8:   73728 bytes =  72 KiB
```

![Bar chart: Qwen3-4B KV cache is 144 KiB per token in bf16 and 72 KiB in FP8, half K and half V](./figures/03_kv_bytes.png)

*KV cache per token of Qwen3-4B, computed from the model config. FP8 halves every term.*

The engine agrees: SGLang logged an FP8 pool of 200,084 tokens with K and V of 6.87 GiB each, which is 200,084 x 73,728 bytes split in two; the bf16 pool of 52,311 tokens logged 3.59 GiB each.

## 2. Tokens per pool

At startup the engine turns most memory left after weights and working space into a **KV pool**, a fixed number of token slots shared by all requests. With round numbers, 10 GB left for an FP8 cache gives 10 x 10^9 / 73,728 = 135,634 tokens (hypothetical).

![Bar chart: KV pool on one L4 grows from 52,311 tokens (bf16) to 200,067 (final FP8 config); peak use at 225 users was about 22,000](./figures/03_pool_tokens.png)

*KV pool on one L4 from SGLang server logs. The last two blue bars use the same dtypes; the step from 154,343 to 200,067 comes from other server settings, which we did not break down. Dashed line: peak use at 225 users.*

FP8 weights added about 25,000 tokens, and halving the bytes per token then gave 154,343 tokens, 2.95 times the bf16 pool. The final pool of 200,067 tokens is 14.8 GB of the 24 GB card (computed).

That pool was never the limit. At 225 users, our capacity edge, the log showed at most 9 requests running and peak use of 11 % of the pool, while standard attainment was 0.906 ± 0.017 over 3 seeds. Our reading is that prefill compute was the limit. A small pool does hurt: with three models co-hosted on one L4 the LLM's pool shrank to about 28,800 tokens, 98 % in use, and standard attainment fell to 0.508 ± 0.028 (3 seeds). That run could not separate KV pressure from the GPU time the vision model took.

## 3. Paged attention

Early engines gave each request one contiguous slot sized for its longest possible answer. With a round slot of 8,192 tokens, our request leaves (8,192 - 2,100) / 8,192 = 74 % of it reserved and unused. PagedAttention (Kwon et al., 2023) cuts the pool into fixed-size **blocks** instead. Each request's **block table** maps its logical blocks to physical blocks anywhere in the pool, and the attention kernel reads through it.

![Diagram: a 2,100-token request wastes 74 % of an 8,192-token slot, but only 12 slots, 0.6 %, in 132 scattered 16-token blocks](./figures/03_block_table.png)

*The same request in a contiguous slot and in 16-token blocks. Physical block ids are illustrative.*

A request takes a new block only at a block boundary, so at most 15 slots sit empty. Ours needs ceil(2,100 / 16) = 132 blocks, with 12 slots empty, 0.6 % (computed). One block of Qwen3-4B in FP8 is 16 x 72 KiB = 1,152 KiB. Sixteen is vLLM's default block size; we checked it in the v0.32.0 source while our runs used 0.30.0. The paper reports 2 to 4 times the throughput of FasterTransformer and Orca at the same latency, on its own hardware; we did not reproduce that.

The table also lets requests share a prefix. vLLM and TensorRT-LLM key each full block by a hash of all tokens up to it; SGLang keeps a token-level radix tree. If chat turn 1 was 40 tokens, turn 2 re-sends it: two full blocks (32 tokens) hit and skip prefill, and the 8-token partial block is recomputed.

## 4. Prefix cache and offload on one L4

Our load generator re-sends the whole conversation on every chat turn, so 48 to 59 % of prompt tokens repeat the same session's earlier tokens; only 0.2 to 1.0 % come from other sessions. At U = 498 (10 minutes, one seed each) we ran SGLang's radix cache on and off. With it on, 14.9 % of prompt tokens were hits, and standard attainment rose from 0.695 to 0.777, 8.2 points.

Our reading of the low hit rate is that histories are evicted before their owner returns. A CPU simulation of the same request stream, with the final pool of 199,770 tokens, showed that at 520 users the pool holds about 2 minutes of new KV traffic, while think time has a median of 116 s and a mean of 351 s.

A host-RAM tier keeps evicted blocks and copies them back over PCIe on a hit. The simulation says such a tier helps only when it is several times the GPU pool. Our first test broke that rule: an 8 GB host pool holds 108,506 tokens, 0.70 times the on/off run's 154,343-token GPU pool, and gave a 14.6 % hit against 14.9 % without it. A 64 GB host pool is 4.34 times the 200,084-token GPU pool, and SGLang's log counted 868,056 host tokens, which matches 64 x 10^9 / 73,728.

```bash
# vLLM: FP8 KV, prefix caching, 64 GiB host tier, report cached tokens per request
vllm serve Qwen/Qwen3-4B-Instruct-2507-FP8 --kv-cache-dtype fp8_e4m3 --enable-prefix-caching \
  --kv-offloading-size 64 --kv-offloading-backend native --enable-prompt-tokens-details

# SGLang: radix cache on by default; 64 GB host tier, write-through
python -m sglang.launch_server --model-path Qwen/Qwen3-4B-Instruct-2507-FP8 --kv-cache-dtype fp8_e4m3 \
  --enable-hierarchical-cache --hicache-size 64 --hicache-write-policy write_through --enable-cache-report
```

Each engine ran with and without the host tier: FP8 cache, 20-minute warm-up, 10-minute window, one seed per cell, vLLM 0.30.0 and SGLang 0.5.20. Read each row against its own baseline only.

| engine, U | prefix hit | standard | strict |
|---|---|---|---|
| SGLang, U = 260 | 23.1 % -> 34.6 % | 0.914 -> 0.927 | - |
| SGLang, U = 520 | 16.0 % -> 29.2 % | 0.582 -> 0.770 | - |
| vLLM, U = 320 | 23.3 % -> 34.8 % | 0.904 -> 0.915 | 0.575 -> 0.603 |
| vLLM, U = 520 | 16.2 % -> 28.9 % | 0.783 -> 0.799 | 0.294 -> 0.304 |

The hit rate rose by 11.5 to 13.2 points in every row. For SGLang at 260 users the simulation had predicted 23 -> 36 % and 16 % less prefill work; we measured 23.1 -> 34.6 % and 15 % less, with prefill busy itself modelled from measured token counts at 0.2 ms per uncached token.

Attainment did not move reliably. On vLLM every change sits inside the 0.02 to 0.05 noise of a single L4 run,. On SGLang at U = 520 standard attainment rose by 0.19 with one seed, unconfirmed until we run 3 seeds. The simulation adds one structural reason: at 520 users, 45 % of prompts of 3,000 tokens or more are first turns, which no cache can serve.

Hits are a token-weighted share of `usage.prompt_tokens_details.cached_tokens`, which both engines return per request with the flags above; for vLLM we checked that it includes tokens loaded from host RAM. A custom script collects it:

```python
cached = prompt = 0
for rec in records:                       # one record per finished request
    if rec.cached_tokens is None or rec.prompt_tokens == 0:
        continue                          # engine did not report it
    cached += rec.cached_tokens
    prompt += rec.prompt_tokens
prefix_hit = cached / prompt if prompt else None
```

## 5. Limits

- 144 KiB and 72 KiB are computed; the logged K and V sizes and host-pool count agree, but we did not measure GPU bytes directly.
- The prefix-cache gain of 8.2 points and every offload number come from one seed per cell. The SGLang gain at U = 520 is unconfirmed.
- The offload rows differ in engine, version and baseline, so the table does not rank SGLang against vLLM.
- Hit rates depend on our synthetic generator, which has no shared system prompt or shared RAG documents.
- We did not profile attention kernels; block and hashing details come from the paper and framework docs.
- The 8,192-token slot and the illustrative block ids are round examples, not any engine's setting.

## 6. Reproduce

```bash
python -c "print(2*36*8*128*2, 2*36*8*128*1)"          # 147456 73728
python -c "print(200067/2100, 64e9/73728, 8e9/73728)"    # 95.3, 868055.6, 108506.9
```

GPU runs, all 1 x L4 on Modal: session 4 (radix on and off, 8 GB host tier), 24a (pool usage at 225 users), 29a and 29b (SGLang radix against 64 GB host tier, about 3.5 USD estimated), 32a, 32b, 33a and 33b (vLLM offload, about 2 USD per pair, estimated). The offload simulation runs on CPU in about 11 minutes.

## 7. Sources

- CHANGELOG Step 158 (SGLang 64 GB host tier), Steps 169 and 170 (vLLM offload at U = 320 and 520).
- Notes 07 §4 (radix cache on and off, 8 GB host tier), 20 (reuse structure, offload simulation, ratio rule), 26 (three models on one L4), 32 §4 (pool and usage of run 24a), 41 §1 and §3.1 (paged blocks, prefix keys, vLLM block size 16).
- Report Chapters 2, 4, 5, 7 and 8.
- Runs: 20261009-1254_session4_quant-cache, 20261014-2347_session24a_one-l4-edge-seeds, 20261023-1225_session29a_one-l4-hicache-radix, 20261023-1225_session29b_one-l4-hicache-64; sessions 32a, 32b, 33a, 33b on the outputs repository.
- Kwon et al., "Efficient Memory Management for Large Language Model Serving with PagedAttention", https://arxiv.org/abs/2309.06180.

Written with Claude Code. Numbers checked against the runs under Sources.
