---
title: "Scale, latency and cost: an estimate, a miss and a $1.43 bill"
description: "How many users ott-chat could carry (estimated, not load-tested), why delivery took a median 626 ms against a 200 ms target, and what AWS and AI cost each month."
pubDatetime: 2026-11-22T00:00:00Z
kind: series
series: ott-chat
part: 6
project: ott-chat
draft: false
tags: [capacity, latency, cost, serverless, aws]
---

Cost was our first-ranked quality, and performance sat below it. This part puts numbers on both: how far the free setup could stretch, how fast a message really travelled, and what the bill said. Every capacity figure here is an estimate; we never ran a load test.

## Key results

- **About 300 active users comfortably.** Degrading from about 430, breaking somewhere between 1,000 and 2,500. An estimate from published limits, not a test.
- **The first limit was a setting we chose.** The WebSocket throttle of 50 requests a second; raising it costs $0.
- **The first hard limit was the free chat database.** Neon at 0.25 compute units, and its 100 compute-hours a month.
- **Latency missed the target.** A message took a median 626 ms from send to the other screen, against 200 ms.
- **AWS cost $1.17 to $1.43 a month.** No load balancer, no NAT gateway, no containers.
- **AI spend was capped in code.** $0.05 per user a day, $2 a day, $20 a month; the provider's free quota kept it at $0.

## 1. Capacity, hop by hop

![Send and delivery paths across AWS with five numbered limits: (1) edge throttles, WebSocket 50 rps and send 20 rps, raised for $0; (2) Lambda, 1,000 concurrent, about 6,400 active users; (3) API Gateway, SNS and DynamoDB at 15,000 to 34,000 users; (4) Neon chat database at 0.25 CU, 600 to 1,900 active users, marked as the limit; (5) Supabase pooler, 500 to 2,500 active users.](./figures/aws-capacity.png)
*Each hop's published limit turned into a number of active users.*

| Hop | Limit | Active users it supports |
|---|---|---|
| WebSocket stage throttle | 50 rps (our setting) | about 430, first |
| Send route throttle | 20 rps (our setting) | 600 |
| Neon chat database | 0.25 CU, free plan | 600 to 1,900 |
| Supabase pooler | 200 clients | 500 to 2,500 |
| Lambda account | 1,000 concurrent, shared | about 6,400 |
| SNS, API Gateway, DynamoDB | account quotas | 15,000 to 34,000 |

The course asked for 200 concurrent connections, and the plan was a k6 load test. It was never built. Instead, on 20 November we read the live quotas and turned each into users with a simple model: an active user sends one message every 30 s, types for about 10 s per message, and 20 % of connected users are active.

> **In plain words: Little's law**
> Busy workers = arrivals per second × seconds each job takes. If 100 requests arrive each second and each takes 0.15 s, about 15 are in progress at any moment. We used it to turn "requests per user" into "Lambda functions running at once" and compared that with each limit.

## 2. What breaks first

| Fix | Moves the limit to | Cost per month |
|---|---|---|
| Raise WebSocket and send throttles, typing only on start and stop | the databases | $0 |
| Neon paid plan, 0.25 to 1 CU autoscaling | more CPU, no hour quota | about $19 to $38 |
| Smaller pools, or Supabase Pro with more compute | fewer pooler clients, a bigger database | $0, or $25 plus $15 |

The first wall was our own throttle. From about 430 active users, typing and heartbeat frames would be dropped. A refused send gets a 429 and the client resends it with the same id: slower, never lost. The first hard wall was the free databases: Neon running out of CPU, then 503s.

A calendar limit came before any of these. 100 compute-hours at 0.25 CU means about 400 awake hours a month, about 13 a day, so steady use plus backups could suspend the chat database before month end. It happened once: a one-minute poll burned the quota in 17 days (D-145). Two more walls came from sharing. The Lambda account served four other projects, and its limit of 10 concurrent functions throttled chat on 18 November until AWS raised it to 1,000. And Supabase Auth allows 30 sign-ins per 5 minutes per IP address, so a class signing in from one campus network would hit that first.

## 3. Latency against the 200 ms target

![Send path and delivery path on AWS. Send: web app posts to CloudFront, API Gateway HTTP and the chat Lambda, which inserts into Neon and acknowledges (55 to 80 ms warm by design). Delivery after the acknowledgement: inline publish to the SNS events topic, the realtime queue, the realtime Lambda that looks up member sockets in DynamoDB, and the WebSocket API posting one frame per socket. A cold-start panel shows an optional EventBridge warm-up every 5 minutes, off by default. Measured on dev: POST /messages p50 113 ms, send to frame median 626 ms. Tried and dropped: Lambda minify, ECS Fargate.](./figures/aws-latency.png)
*The sender waits only for the insert; delivery runs after the answer.*

| What | Measured | How |
|---|---|---|
| Edge, health check | p50 96 ms, p90 140 ms | 20 samples, 20 Nov |
| Send acknowledgement | p50 113 ms, p95 298 ms | API Gateway access log |
| Send to frame on the other screen | median 626 ms (318 to 1,710) | 10 scripted runs; QA saw 570 to 600 ms |
| Cold start, chat | 190 to 740 ms, on 4 to 10 % of calls | baseline |

The target (NFR-1) was 200 ms at the median with a warm function. We missed it end to end. The edge answered in about 100 ms, so the network was not the problem. The acknowledgement already took more than half the budget, and delivery added roughly 500 ms more. We had no per-hop timings for that half second across SNS, SQS, the realtime function and the WebSocket post, so I will not name a cause.

Cold starts were the other cost. After a long idle, the first request could take 6 to 10 s while Neon woke up. One provisioned instance on chat would hide the cold start for about $5 to $6 a month; we did not buy it. An optional warm-up ping (D-185) stayed off except on demo days. We also built the HTTP services on ECS Fargate and measured them (D-164): warm p50 43 ms against 61 ms on Lambda. That gain was not worth a monthly bill, so we removed it.

## 4. The monthly bill

| AWS line (Cost Explorer) | Sep | Oct | Nov 1 to 20 |
|---|---|---|---|
| Route 53 (DNS zone) | 0 | 0.53 | 0.52 |
| ECR (container registry) | 0.37 | 0.37 | 0.23 |
| S3 | 0.13 | 0.26 | 0.10 |
| Other (End User Messaging, SQS, API Gateway, CloudWatch, tax) | 0.67 | 0.27 | 0.18 |
| **Total, US$** | **1.17** | **1.43** | **1.03** |

The target was $0, and we missed it by about a dollar. The largest lines were not compute: a DNS zone and a container registry. Lambda, DynamoDB and SNS stayed inside their free tiers. The 32 alarms cost $0.04 in 20 days, not the $2.50 a month an early draft modelled. Supabase, Neon and Cloudflare were on free plans.

## 5. The bills we avoided

![Log-scale bar chart of estimated monthly cost: today's stack $0.10 to $1.00 (an early estimate); the vision to Stage 1 $3 to $5; to Stage 5 $4 to $6; with Stage 6 on ECS $24 to $26; and the rejected D-02 design with ECS, a load balancer and Redis for 8 services at about $102.](./figures/fig-ch11-cost.png)
*Our estimates, not invoices. The real bill is the table above.*

- **Containers with a load balancer: about $102 a month** for eight services, with a Redis backplane for sockets (D-02). API Gateway held the sockets for free; containers win only near 3,000 concurrent connections.
- **A NAT gateway: about $43 a month** (D-42), needed only if the functions sat in a VPC.
- **The cheapest highly available container setup** we priced on 29 October was about $20 a month without a load balancer, $45 to $50 with one, and over $110 with NAT gateways. Each was mostly fixed cost, and none raised the real ceiling, the databases.

Pay per use grows with use: about $0.005 per active user-hour at list prices, an assumption. 500 users for 4 hours a day would be roughly $300 a month before free tiers.

## 6. AI cost and the spending cap

| Ceiling | Value |
|---|---|
| Per user per day | $0.05 |
| Whole system per day | $2.00 |
| Whole system per month | $20 |

AI was the one bill that grew with use. In October I asked what OpenAI would cost. Small models came to about $1 a month for 50 users and 1,000 messages a day, but a large model costs about 100 times more, and one looping bug could burn tens of dollars a day.

So the ai service owned spend (D-142). A kill switch and consent check fail closed. Results are cached for 24 hours. Each call first reserves its worst-case cost against all three ceilings, and the reservation expires after 60 s so a crashed function cannot lock the quota. The active provider, Gemini, had a free quota, so we paid $0. The worst case was the $20 monthly cap, reached after ten days at the $2 daily cap: the cap limits the damage, it does not make it zero.

## Limits

- No load test exists. Every capacity number is an estimate; database throughput is the least certain input.
- The latency figures are end to end; no per-hop timing was taken.
- The AWS account was shared, so the bill covers other projects too; it was not tagged per project.
- The AI features were not re-run after the QA run of 18 November found the provider answering 503.
- Container and plan prices are our estimates from list prices, not quotes.

## Sources

- Final report: 2.6 (p22 to 23), 3.5 to 3.7 (p26 to 29), 5.1.6 (p50), 5.3 to 5.4 (p54 to 56, Table 21), 7.7 to 7.8 (p80, Table 24).
- `report/presentation/capacity-analysis.md` (20 November), sections 3 to 6 and 8.
- Repo `docs/decisions.md`: D-02, D-42, D-142; report decision index for D-145, D-164, D-185.
- Owner's Q&A notes: 3 October (OpenAI cost), 29 October (minimum ECS cost for HA), 18 and 21 November (cost).
