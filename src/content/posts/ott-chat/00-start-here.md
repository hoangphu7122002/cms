---
title: "Start here: ott-chat, a chat system on AWS in one page"
description: "The whole ott-chat system in seven diagrams: eight serverless services on AWS, one event bus, $1.17 to $1.43 a month, and what we measured and missed."
pubDatetime: 2026-11-22T00:00:00Z
kind: series
series: ott-chat
part: 0
project: ott-chat
draft: false
tags: [system-design, microservices, event-driven, serverless, aws]
---

ott-chat was a Zalo-like chat system that my team of four built for a software architecture course, from the first requirements on 21 September to the report on 21 November 2026. It ran as eight serverless services on AWS for under a dollar and a half a month, and we tore the dev stack down on 22 November 2026. If you read one post in this series, read this one: every key diagram is here, and the other nine parts go deeper.

## Key results

- **54 features, 50 live.** Push to a closed app waited for deploy; e-mail alerts, group calls and an incoming-call ring were not built.
- **Eight services, 17 functions, one bus.** AWS Lambda on arm64, one SNS topic, seven SQS queues, five databases.
- **AWS cost $1.17 to $1.43 a month.** The target was $0. The largest lines were a DNS zone and a container registry, not compute.
- **Latency target missed.** A send was acknowledged in 113 ms (median) but reached the other screen in a median 626 ms, against 200 ms.
- **About 300 active users comfortably, by estimate.** No load test was run. The free chat database is the first hard limit.
- **Backups restored daily in a second region.** Recovery estimated at 2 to 4 hours, with up to 24 hours of data lost. Failover was never run.

## The system in seven diagrams

### 1. The whole system on AWS

![ott-chat on AWS in one region: CloudFront and S3, an HTTP API Gateway with 4 HTTP functions, one SNS topic feeding 7 SQS queues, 7 consumers and 7 dead-letter queues, EventBridge schedules, a WebSocket gateway with DynamoDB, and Supabase, Neon and Gemini outside AWS; orange numbers mark the flow](./figures/aws-arch.png)
*The whole system on one page, drawn from the Terraform code.*

Everything ran in one AWS account, one region (Singapore) and one environment. CloudFront served the web and admin apps from S3. An HTTP API Gateway sent requests to four functions; a second gateway held the WebSockets, with live connections in DynamoDB. EventBridge ran five scheduled jobs: two outbox relays, a keepalive, a nightly backup and a daily restore.

Cost ranked first, so there was no server of ours. Containers behind a load balancer were priced at about $102 a month (D-02); Lambda cost nothing while idle, because API Gateway holds the sockets. Outside AWS we rented Supabase for sign-in, Neon for the other databases, Gemini for AI and Cloudflare for call relays.

### 2. Eight services, five databases

![Eight service functions in Singapore, each pointing at its own store: identity at Supabase Postgres and Auth; notification, ai, chat and analytics at their own Neon projects; realtime at a DynamoDB connections table; media at the S3 media bucket; moderation has no database and reads events only](./figures/aws-services.png)
*Eight services, five databases. Realtime, media and moderation keep no Postgres.*

We cut by business area: a few large core services (identity, chat) and many small ones at the edge (realtime, notification, analytics, moderation, media, ai). Each service owns its data, with no foreign keys and no reads across services (D-129). What it needs from others, it keeps as a copy fed by events. Chat owns group membership, because a permission check must never read a copy (D-49).

Inside each service the code has four layers: domain, application, adapters and entrypoints. A lint rule fails the build on a forbidden import, and the measured code had 0 among 2,108 imports.

### 3. One topic, a queue per consumer, an outbox

![Three publishers (identity relay, chat relay, chat Lambda publishing MessageSent inline) feed one SNS events topic with 16 event types. The topic fans out to seven SQS queues, each with a dead-letter queue, feeding seven consumers: notification, chat, analytics, identity, media, moderation, realtime](./figures/aws-eventdriven.png)
*One topic, no central coordinator, one queue and dead-letter queue per consumer.*

A service writes its own database, then publishes. SNS copies each of 16 event types into seven queues. After five failed deliveries a message waits 14 days in a dead-letter queue, and an alarm e-mails a person. One consumer's failure stays its own: moderation once failed for a whole release, and analytics lost nothing.

Events that feed a copy go through a transactional outbox: the event row is written in the same transaction as the change, so it cannot be lost. Waking the relay after each write cut a block's trip to chat from 59.4 s to 0.4 s (median). Delivery is at least once, so every consumer records `(event_id, handler)` before acting. Order never comes from the bus, only from the database. Account deletion is a saga with no rollback; the sign-in is removed last.

### 4. One message, end to end

![Send path and delivery path on AWS. Send: web app posts to CloudFront, API Gateway and the chat Lambda, which inserts into Neon and acknowledges. Delivery after the acknowledgement: publish to SNS, the realtime queue, the realtime Lambda that looks up member sockets in DynamoDB, and the WebSocket API posting one frame per socket. Measured on dev: POST /messages p50 113 ms, send to frame median 626 ms](./figures/aws-latency.png)
*The sender waits only for the insert; delivery runs after the answer.*

The sender waits for one INSERT. Chat checks membership, blocks and banned words, stores the row with a server-assigned order number, `seq`, and answers. A retry with the same client message id gets the same row back, never a second message. After the commit, the realtime function posts one frame to each open socket of each member.

The push may fail. A device that missed frames calls `/sync` with its last `seq` and gets everything after it. Sent, delivered and seen are two cursors per member, not rows per message. The acknowledgement took 113 ms at the median; the other screen saw the message after a median 626 ms over 10 runs. We never timed each hop, so I cannot say where that half second went.

### 5. What breaks first

![Send and delivery paths across AWS with five numbered limits: edge throttles of 50 and 20 requests a second; Lambda at 1,000 concurrent, about 6,400 active users; API Gateway, SNS and DynamoDB at 15,000 to 34,000 users; the Neon chat database at 0.25 compute units, 600 to 1,900 active users, marked as the limit; the Supabase pooler at 500 to 2,500 active users](./figures/aws-capacity.png)
*Each hop's published limit turned into a number of active users.*

We never ran a load test. Instead we read the live quotas and turned each into users with a simple model: an active user sends one message every 30 seconds, and 20 % of connected users are active. The first limit was our own WebSocket throttle, at about 430 active users, and raising it costs $0. The first hard limit was the free chat database: 0.25 compute units and 100 compute-hours a month. A one-minute poll once spent those hours in 17 days.

Cold starts were the other price: 190 to 740 ms on 4 to 10 % of calls, and 6 to 10 s after a long idle.

### 6. Security, availability and recovery

![High availability design. Singapore primary: regional services are multi-zone by AWS design; Supabase and Neon primaries with assumed standbys. A backup Lambda writes daily at 19:00 UTC to a versioned S3 bucket replicated to Sydney, where Supabase and Neon standbys are loaded daily at 20:00 UTC; a Sydney compute stack is drawn in red as a target, not built](./figures/aws-ha.png)
*Green is built, red dashed is designed but not built, purple dotted is assumed on the provider side.*

Supabase Auth signed users in, and every service checked their JSON Web Token itself; user ids came from the token, never the request. Of seven security layers, six worked; one database role per schema stayed a gap (D-100). There was no private network (VPC), because nothing listened on a port and a NAT gateway would cost about $43 a month.

The availability we reached was zone level, which AWS gives managed services for free, plus a daily copy of all five databases loaded into Sydney. Sydney compute and automatic failover were designed and deferred. Two Terraform roots keep the Sydney state out of the Singapore outage.

### 7. Calls, and what stayed on paper

![One-to-one call: both browsers ask the chat Lambda for ICE servers (public STUN, and Cloudflare TURN whose key is read from Parameter Store); call frames travel over the WebSocket API to chat-ws and are relayed to the other browser; media goes peer to peer; the caller writes one call-log message](./figures/aws-calls.png)
*Our servers see signalling only; the media never touches AWS.*

One-to-one calls reused the chat socket for signalling, sent audio and video browser to browser, and rented Cloudflare's free TURN relay for networks that block a direct path. They cost $0 of our infrastructure, but no call was ever run on the deployed stack. Group calls were designed (mesh for small groups, a forwarding server above 4 people) and not shipped. A history archive to S3 was designed and started on a branch, not merged; only its schema exists.

Around the chat sat the other features: AI translate and summarise behind a spending cap in code, statistics built from events, and moderation that retracts after send with an admin review.

## Read next

| Part | Title | What you learn |
|---|---|---|
| 1 | [The whole picture](/posts/ott-chat/01-system-design/) | the brief, the ranked qualities, the shape and the decisions that mattered |
| 2 | [Architecture style](/posts/ott-chat/02-architecture-style/) | how the services were cut, why Lambda beat containers, why TypeScript |
| 3 | [The codebase](/posts/ott-chat/03-codebase-ddd/) | domain folders, four layers, import rules the build enforces |
| 4 | [Data and events](/posts/ott-chat/04-data-events/) | PostgreSQL on two providers, outbox, idempotency, the deletion saga |
| 5 | [AWS, security and availability](/posts/ott-chat/05-aws-ha-security/) | sign-in, security layers, backups, the Sydney pilot light, Terraform |
| 6 | [Scale, latency and cost](/posts/ott-chat/06-scale-latency-cost/) | capacity per hop, the latency miss, the monthly bill, the AI cap |
| 7 | [Chat core](/posts/ott-chat/07-chat-core/) | WebSocket push, `/sync`, receipts, presence, push to closed apps |
| 8 | [History and calls](/posts/ott-chat/08-history-and-calls/) | the archive design, WebRTC and TURN, group calls on paper |
| 9 | [AI, analytics, moderation and the apps](/posts/ott-chat/09-ai-analytics-moderation/) | the AI guard, event-built statistics, two-tier moderation, four clients |

## Limits

- **No load test.** Every capacity number is an estimate from published limits and an assumed user.
- **No per-hop timing.** The latency figures are end to end, from 10 scripted runs.
- **Failover was never run.** The 2 to 4 hour recovery comes from reading the runbook.
- **The end state was moving.** Closed-app push and two database moves were merged in the last days but not confirmed deployed; calls and AI were not confirmed on the deployed stack.

## Sources

- Parts 1 to 9 of this series; each lists its own report pages, repository files and decision IDs.
- Final report, §2 to §8; repository `docs/decisions.md` (D-02, D-49, D-100, D-129, D-164) and `terraform/live/`.
