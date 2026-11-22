---
title: "ott-chat, the whole picture: a Zalo-like chat on a $0 budget"
description: "How a team of four turned 95 requirements and a zero-dollar budget into eight serverless services, five databases and one event bus on AWS, and what each choice gained and cost."
pubDatetime: 2026-11-22T00:00:00Z
kind: series
series: ott-chat
part: 1
project: ott-chat
draft: false
tags: [ott-chat, system-design, software-architecture, aws, serverless, microservices, event-driven]
---

ott-chat is a chat system in the spirit of Zalo: sign up, find friends, make groups, send text, pictures, video, files and voice notes in real time, call one person, ask an AI to translate or summarise. My team of four built it for a university software architecture course over about nine weeks, from the first requirements on 21 September to the report on 21 November 2026. I led the architecture, the codebase, security, availability and latency work. This post is the map: what we had to build, which qualities we ranked first, the shape that followed, and what each big decision bought and cost. The posts after it zoom into one piece each.

We tore the dev stack down on 22 November 2026, so this post describes the system as it was built and measured, mostly in the past tense.

## Key results

- **54 features, 50 live.** The 95 functional requirements became 54 features. 50 ran on the dev stack, 1 (closed-app push) was written and waiting for deploy, 3 were not built (e-mail notifications, group calls, a ring for incoming calls).
- **Three driving characteristics.** Cost ($0 recurring), deployability (a release to the cloud every week, one function at a time) and data correctness (no lost, duplicated or misordered message). Everything else was kept above a floor or left out on purpose.
- **Eight services, five databases, one bus.** Microservices, event-driven through one SNS topic and seven SQS queues, on AWS Lambda. 17 Lambda functions were deployed (18 declared). Identity sat on Supabase, chat and analytics on their own Neon projects, with two more Neon projects created for notification and AI.
- **Cost: about $1.0 to $1.5 a month.** Not $0, but close: mostly a DNS zone and a registry line. The free plans set the real limits.
- **Latency target missed.** A send was acknowledged in 113 ms at the median, but reached the other screen in about 570 to 630 ms. The target was 200 ms.
- **Capacity is an estimate, not a test.** About 300 active users comfortably (roughly 1,000 connected), with the free chat database as the hard limit at 1,000 to 2,500 active users. No load test was ever run.

## 1. What the system is

**The brief.** The task was one line: build an OTT messaging system modelled on Zalo. Around it sat eight binding items. Three were functional: manage accounts and groups, one-to-one and group chat with five content types, and statistics on user activity. The rest were about process: go through all five stages (requirement, design, code, test, deploy), release to the cloud every week, explain the design in the course's terms, work in a team of three or four with a leader, and hand in the report in week 11. A technology list (Java, MySQL, NoSQL, Node.js, ASP.NET) was only a suggestion.

**What we built.** People register, find others, add friends, make groups and chat in real time. Messages carry text, images, video, documents, voice and reactions. They show sent, delivered and seen, and can be edited, retracted, forwarded, pinned and replied to. Two people can hold a voice or video call. Text is moderated after it is sent. A user can ask for a translation or a summary under a spending cap. An admin console shows statistics, reviews what moderation removed and can lock accounts.

There were four clients: a web app (React), an admin console, an Android app (a Capacitor shell around the web code) and a native macOS app in Swift. iPhone users installed the web app as a PWA, because we dropped a native iOS app.

The 54 features fell into eight blocks, each owned by one or two services: accounts and friends (identity), conversations, messages and rich features such as polls and mentions (chat), delivery and multi-device sync (chat, realtime, notification), calls and AI (chat, ai), and admin and safety (analytics, moderation).

**Size.** On 18 November the backend held about 29,000 lines of TypeScript across eight services plus shared code. Chat alone was 14,527 lines in 155 files, about half the backend. The web client, at 32,699 lines, was larger than the whole backend. The decision log ran from D-01 to D-191, and main had 792 commits.

## 2. The requirements

**Problem.** Functional requirements say what the system does. They rarely decide its shape. I needed to know which requirements would move a seam, a technology or a dependency rule, and which would only add a screen.

**Functional groups.** The requirements file listed 95 functional requirements in 12 groups, ranked with MoSCoW: 39 Must, 36 Should, 19 Could, 1 Won't.

| Group | Subject | Must | From the brief? |
|---|---|---|---|
| FR-1 | accounts, friends, privacy, authorisation, admin roles, deletion | 7 | yes |
| FR-2 | groups: create, add, remove, roles, invite links | 7 | yes |
| FR-3 | one-to-one chat: real time, history, order, no duplicates | 5 | yes |
| FR-4 | group chat: fan-out, history, sender latency | 3 | yes |
| FR-5 | content types and message actions | 6 | yes |
| FR-6 | activity statistics | 4 | yes |
| FR-7 | moderation after sending | 0 | added |
| FR-8 | notifications | 1 | added |
| FR-9 | multi-device and delta sync | 2 | added |
| FR-10 | AI translate and summarise, with spend guardrails | 1 | added |
| FR-11 | rate limiting and abuse controls | 2 | added |
| FR-14 | one-to-one voice and video calls | 1 | added |

The first six groups answer the brief: 68 requirements and 32 of the 39 Must. The other 27 we added, either because they follow from the brief (a chat on a phone and a laptop needs multi-device sync) or because they exercise a course idea (moderation as an async consumer, AI as a separate cost boundary).

A few requirements carried real architectural weight. FR-3.3 puts message order in a server-assigned sequence number, `seq`, not in arrival order. FR-3.8 says a retried send must not create a second message, which forces a client-generated id with a unique key. FR-4.4 says the sender's wait must not grow with the size of the group, which separates the acknowledgement from the fan-out. These three shaped the send path more than any feature did.

**Non-functional requirements.** There were 21. The ones that mattered most:

| Id | Target |
|---|---|
| NFR-1 | a message reaches an online recipient in under 200 ms (p50, warm) |
| NFR-3 | at least 200 concurrent connections for the demo |
| NFR-4 | messages in a conversation always in order |
| NFR-5 | event processing idempotent per consumer, keyed by (event_id, handler) |
| NFR-12, NFR-13 | each function deploys alone; weekly releases |
| NFR-16 | $0 per month of recurring infrastructure; a domain is the only spend |
| NFR-19 | use-case logic runs with no AWS dependency |
| NFR-21 | abuse bounded with no recurring cost: edge throttling plus a per-user counter, no WAF |

## 3. Architecture characteristics, ranked

**Problem.** Richards and Ford call the qualities that decide a system's shape architecture characteristics, and advise keeping the list of drivers short, because each one makes the design harder. Our course mapping listed seven characteristics with no order, and nobody gave us a priority list. Without a ranking, every disagreement would be argued from zero.

**Options.** I could rank by what the requirements say loudest, by what the course rewards, or by what actually won when two characteristics collided. I chose the last. I went through the decision log and asked, for each conflict, which side won.

**Decision.** The ranking that came out has three tiers.

![Three tiers of characteristics. Driving: 1 cost ($0 recurring, NFR-16, C-8), 2 deployability (weekly, independent, NFR-12 and NFR-13), 3 data correctness (order, idempotency, local authorisation reads). Supporting: performance, testability, evolvability, security, modularity. Not optimised: availability, fault tolerance, auditability, scale beyond the demo.](./figures/fig-ch02-ranking.png)

The figure shows the three tiers. One correction to it: fault tolerance started in the bottom tier and moved up to supporting during the project, as the outbox, the account-deletion saga and daily backups were added.

1. **Cost first.** The $0 budget was a team constraint (C-8), not a line in the brief, and it removed whole families of technology: no VPC, no NAT gateway, no load balancer, no managed relational database, no WAF, no provisioned concurrency. The decision log priced what it rejected: containers behind a load balancer at about $102 a month (D-02), a NAT gateway at about $43 (D-42). Whenever cost met latency, cost won.
2. **Deployability second.** The brief asked for a cloud release every week. Each function got its own version and live alias, so it could ship and roll back alone.
3. **Data correctness third.** Its failures are silent and permanent. A double-counted event or a message shown to a removed member raises no error. So order comes from `seq` only, a unique `client_msg_id` stops duplicates, consumers are idempotent, and authorisation reads only the owning service's own tables.

**Trade-off.** Performance sat below these three, and that was a structural choice, not an accident. The send was acknowledged right after the database write, but live delivery then crossed an SNS topic, an SQS queue and a second function. Every hop existed because of cost or deployability, and every hop could be cold. I knew this when I ranked it. Section 7 shows what it cost.

We also named four characteristics we chose not to buy: availability beyond one region, observability beyond logs and alarms, auditability beyond two audit tables, and scale beyond the demo. Each would cost money every month or a second environment to prove.

## 4. Constraints

The requirements file listed ten constraints. Five restated the brief: deadlines (C-1), a team of three or four with a leader (C-2), the five stages (C-3), weekly releases (C-4), course solutions in the report (C-5). The other five shaped the design before any code:

- **C-6, technology only suggested.** We chose TypeScript on Node.js (D-68), PostgreSQL instead of MySQL (D-05), and DynamoDB for the NoSQL item. We first chose Go and reversed it the same day: the work is I/O bound and TypeScript lets the clients share the API types.
- **C-7, web first.** Packaged apps from the same code, hence versioned `/v1/` paths and CORS for the native shells.
- **C-8, $0 recurring.** Section 3.
- **C-9, one shared AWS account and one Supabase project.** So one environment, dev (D-141). Secrets in SSM Parameter Store, and CI deploying through an OIDC role with no long-lived keys.
- **C-10, clients never query Supabase directly** except to sign in. Every read and write goes through a service, so authorisation lives in our code.

Time mattered too: about nine weeks for four people. The weekly-release item is why the infrastructure and the release path came first, in the first week, before the chat itself.

## 5. Capacity and latency targets

**Problem.** Two targets said how much and how fast: 200 concurrent connections (NFR-3) and 200 ms from send to display (NFR-1). I had to know whether the free tiers could carry the first and whether the event path could meet the second.

**Capacity, by model.** The k6 load test in our plan was never built. On 20 November I built an estimate instead, from live quotas, Terraform settings, client timers and our latency baseline, with Little's law (concurrency = request rate x mean duration). The user model was an assumption: an active user sends one message every 30 seconds in a one-to-one chat and types for about 10 seconds per message; 20% of connected users are active.

![Send and delivery paths across AWS with five numbered limits: (1) edge throttles, WebSocket 50 rps and send 20 rps, raised for $0; (2) Lambda, 1,000 concurrent, about 6,400 active users; (3) API Gateway, SNS and DynamoDB at 15,000 to 34,000 users; (4) Neon chat database at 0.25 CU, 600 to 1,900 active users, marked as the limit; (5) Supabase pooler, 500 to 2,500 active users.](./figures/aws-capacity.png)

The figure walks the send and delivery paths and marks the limit of each hop. Compute scaled with users. The databases did not:

| Hop | Limit | Active users |
|---|---|---|
| Lambda (shared account) | 1,000 concurrent | about 6,400 |
| API Gateway, SNS, DynamoDB | managed quotas | 15,000 to 34,000 |
| Edge throttles (our config) | WebSocket 50 rps, send 20 rps | 430 to 600 |
| Neon chat database, Free | 0.25 CU, 100 CU-hours a month | 600 to 1,900 |
| Supabase Free pooler | 200 pooler clients | 500 to 2,500 |

The result: about 300 active users comfortably, roughly 1,000 connected, so NFR-3 had a wide margin on paper. The first limit was a throttle we set ourselves, which drops typing and heartbeat frames from about 430 active users; a refused send gets a 429 and is resent with the same id, so it is slower but never lost. The hard limit was the free chat database. There was also a limit in calendar time: 100 CU-hours a month is about 400 awake hours at 0.25 CU, and we burned through it once (Section 8).

**Latency, by measurement.**

![Bar chart on a log scale: NFR-1 target 200 ms; design-time warm HTTP send 55 to 80 ms and cold-start penalty about 150 ms (D-69); measured live delivery 4,200 ms on 30 October before fixes; send to render 570 to 600 ms in the QA run of 18 November; first screen after idle 6 to 10 s.](./figures/fig-ch02-latency.png)

The chart puts the target next to what we saw. The newer numbers, all from the dev stack:

| What | Value |
|---|---|
| Edge, `GET /v1/health` | p50 96 ms, p90 140 ms (20 samples) |
| `POST /messages` acknowledgement | p50 113 ms, p95 298 ms |
| Send to frame on the other screen | median 626 ms over 10 runs (318 to 1,710 ms) |
| Send to render, QA run of 18 November | p50 570 to 600 ms |
| Cold start | 190 to 740 ms on 4 to 10% of calls |
| First request after a long idle | 6 to 10 s (observed, not sampled) |

**Trade-off.** The acknowledgement path was fast. The delivery path was not. The edge answered in about 100 ms, so the network was not the problem; the half second after the acknowledgement was spent somewhere in SNS, SQS polling, the realtime function and the WebSocket post. We never timed each hop, so I cannot say which. The 4.2 s of late October and the 0.6 s of November were measured on two different paths, so they are two dates, not a clean before and after.

## 6. The system in context and its containers

**Context (C4 level 1).** Seen from outside, ott-chat is one box with four kinds of people and three rented systems.

![C4 system context: four people (guest who registers, user who chats, group owner, admin who reads statistics) use ott-chat over HTTPS and WSS; ott-chat uses Supabase for sign-in and identity data, Neon for chat and analytics databases, and an AI vendor API (OpenAI or Google Gemini).](./figures/fig-ch01-context.png)

The figure shows the split I wanted from day one: we build one system and rent the identity provider, the databases and the AI model. Authentication is bought from Supabase (D-36); every authorisation decision is ours (FR-1.9, D-49).

**Containers (C4 level 2).** One level down are the clients, the two gateways, the functions, the bus and the stores.

![C4 container view: four clients reach CloudFront, the HTTP API Gateway and the WebSocket API Gateway; behind them five request functions (identity, analytics, ai, chat HTTP, chat-ws); chat and two outbox relays publish to one SNS topic that feeds seven consumer functions; stores are S3, Supabase, two Neon databases and DynamoDB.](./figures/fig-ch03-container.png)

The figure is an earlier snapshot (11 event types, about 16 functions); by the end there were 16 event types and 17 deployed functions, in the same shape. Read it top to bottom: edge, one function per entrypoint, the bus, one consumer per service. Functions call each other over HTTP in only two places: chat calls ai, and the moderation consumer calls chat to retract a message. Everything else is an event.

## 7. As built on AWS, step by step

**Problem.** Put eight services, a real-time path, media and backups on AWS without anything that bills while idle.

**Decision.** Only managed, pay-per-request services, with Lambda as the only compute and no VPC.

![ott-chat on AWS as built, one region: clients on the left; Route 53, CloudFront and S3; an HTTP API Gateway in front of 4 HTTP functions; one SNS topic fanning out to 7 SQS queues, 7 consumers and 7 dead-letter queues with alarms; EventBridge running 2 outbox relays and 3 scheduled functions; a WebSocket API Gateway with chat-ws and DynamoDB; Supabase, 4 Neon projects and Gemini outside AWS. Orange numbers 1 to 8 mark the flow steps.](./figures/aws-arch.png)

The figure is the whole system on one page, read from the Terraform code. The orange numbers are the flow:

1. **DNS.** Route 53 resolved the custom domain, and the app loaded over HTTPS.
2. **Static and media.** CloudFront served the web and admin bundles from S3, and media through signed URLs. Uploads went straight to S3 by presigned POST, never through a function.
3. **API calls.** `/api/v1/*` went through CloudFront to the HTTP API Gateway, which throttled per route, then to one of four HTTP functions (identity, chat, analytics, ai). CloudFront added a secret origin header that the handlers checked, so the raw gateway URL was refused.
4. **Write, then publish.** Each function wrote its own database, then published to the one SNS topic. A send answered the client right after the INSERT.
5. **Fan-out.** SNS copied every event into seven SQS queues, one per consumer: notification, chat, analytics, identity, media, moderation, realtime. Adding a consumer was one new key in a Terraform map; no producer changed.
6. **Failure.** After 5 failed deliveries a message moved to that queue's dead-letter queue, kept 14 days. The first one raised an alarm that e-mailed a person. Redrive was manual.
7. **Sockets.** Browsers kept a WebSocket to a second gateway. The `chat-ws` function stored connections in DynamoDB and handled connect, heartbeat, typing and call signalling. Messages themselves went over HTTP. The realtime consumer looked up members' sockets and posted one frame per socket.
8. **Schedules.** EventBridge ran the two outbox relays, a daily keepalive (so the free Supabase project would not pause), a nightly backup of every database to a versioned S3 bucket, and a daily restore of the newest dump into standby databases in Sydney.

**Numbers.** 17 deployed functions: 4 HTTP, 1 WebSocket, 7 SQS consumers, 5 scheduled. All on Node.js 22, arm64, each behind a live alias. One region (Singapore), one environment. Outside AWS: Supabase for identity and sign-in, four Neon projects, Gemini behind a provider port with OpenAI as the alternative, and Cloudflare TURN to relay calls when two browsers cannot connect directly.

**Trade-off.** No VPC meant nothing of ours listened on a port and no NAT gateway (about $43 a month, since Supabase and Neon sit outside AWS). The price: database traffic crossed the internet under TLS, and trust rested on tokens and connection strings, not a network boundary. Account limits also acted as architecture: the Lambda concurrency limit of 10, shared by all functions, throttled chat on 18 November until AWS raised it to 1,000.

## 8. The key decisions

**Problem.** A decision without a price is a decision I had not understood. So every row in our log carried what it gained and what it cost.

**Style (D-01, D-02, D-42).** I compared five styles against the three drivers:

| Style | Cost | Deployability | Data correctness |
|---|---|---|---|
| Layered monolith | 5 | 1 | 5 |
| Modular monolith | 5 | 2 | 4 |
| Service-based | 4 | 4 | 4 |
| Microservices | 1 | 4 | 2 |
| Event-driven (broker) | 3 | 3 | 2 |
| Our mix on Lambda | 5 | 4 | 3 |

The cost and deployability stars follow the book's ratings where it has them; the modular monolith row and the data-correctness column are my team's judgement. On always-on servers microservices lose on cost, because every unit needs a running process. On Lambda an idle function costs nothing, so the cost column stops separating the styles, and what is left is the trade between deployability and data correctness. We chose microservices, event-driven through a broker, on serverless compute. D-01 states the other reason honestly: microservices is the style that "generates the most problems the course teaches how to solve". Part 2 argues the style in full.

**The decisions that shaped the system:**

| Decision | What it gained | What it cost |
|---|---|---|
| D-02 Lambda, not containers | $0 when idle; API Gateway holds sockets for free (containers about $102 a month with ALB and Redis; break-even about 3,000 connections) | cold starts: 190 to 740 ms, 6 to 10 s after a long idle |
| D-42 no VPC | no NAT gateway (about $43 a month) | trust by token and TLS only |
| D-07 acknowledge after INSERT, fan out after | sender's wait independent of group size | "sent" no longer means "received" |
| D-48 order from `seq`, never from the bus | Standard SNS and SQS (FIFO has no free tier); delta sync with one cursor | order only the database can give |
| D-08 client-generated `client_msg_id` | a retry never duplicates; optimistic UI | a unique key per conversation |
| D-49 chat owns membership | authorisation never reads stale data | membership events disappear; chat holds more rules |
| D-129 a database per service | no cross-schema reads; each schema changes alone | copies of other services' data are eventually consistent |
| D-130, D-145 transactional outbox, relay woken after each write | no lost event for a copy; no always-on poll of Neon | at-least-once delivery; consumers must be idempotent |
| D-141 dev is the only environment | one set of recurring costs | the demo system is the test system |
| D-162 pilot light in Sydney | daily copy of all data in a second region | nothing runs there; failover is manual, estimated 2 to 4 h |
| D-164 ECS Fargate built, measured, dropped | proof, not opinion: warm p50 43 ms against 61 ms on Lambda, both p95 under 90 ms | the only gain was no cold start, for money every month |

**D-129 reversed an earlier rule.** Until October one Supabase database held every schema and services read each other's tables, so a change to a chat table could break analytics with no contract between them. Moving chat and analytics to their own Neon projects fixed that, at a price in timing: a block took a median of 59.4 s to reach chat's copy while the relay waited for its one-minute schedule, and 0.4 s once identity woke its relay on every write (D-165).

**D-145 came from a free tier with a meter.** A relay that polled the chat database every minute kept it awake, and Neon's 100 free compute-hours ran out after 17 days in November. Chat's relay now runs right after each committed write and polls only hourly.

**D-164 tested the rule.** On 19 November we put the HTTP services on ECS Fargate in a public-subnet VPC. It was faster warm and had no cold start, for a monthly bill ($6 to $20 in our two estimates) against $0. We removed it.

**Trade-off of the whole.** We accepted three costs for independent deployment. Copies of other services' data were eventually consistent. There were more moving parts than a team of four would normally run: 17 functions, one topic, seven queues, seven dead-letter queues. And the first request after idle paid a cold start. We kept correctness where it matters most: the send, the membership check and the message order sit in one local transaction of the chat database.

## 9. What it cost to run

The AWS bill, read from Cost Explorer on 20 November, was about $1.0 to $1.5 a month. Lambda, DynamoDB and SNS stayed inside their free tiers; the largest lines were a $0.50 DNS zone and a registry line we never traced. Supabase, Neon and Cloudflare TURN were free. The one bill that grows with use is the AI provider, capped in code at $0.05 per user per day, $2 per day and $20 per month; its free quota kept it at $0. NFR-16 was missed by about a dollar.

## 10. The series

This is part 1. The ★ posts are system design; the others follow a feature through the running system.

| Part | Topic |
|---|---|
| 0 | Start here (written last) |
| 1 | System design, the whole picture (this post) |
| 2 ★ | Architecture style: why microservices, events and serverless, and what we rejected |
| 3 ★ | Codebase: domain folders, clean layers, ports and the import rules CI enforces |
| 4 ★ | Data and events: a database per service, the outbox, idempotent consumers, the deletion saga |
| 5 ★ | AWS high availability and security: trust boundaries, backups, the Sydney pilot light |
| 6 ★ | Scale: latency hop by hop, capacity, cost |
| 7 | Chat core: sign-in, send, real-time delivery, receipts |
| 8 | History and calls: delta sync, media, one-to-one calls |
| 9 | AI, analytics and moderation |

## Limits

- **No load test.** The capacity of about 300 active users is a model built from published limits and an assumed user model. NFR-2 (history page) and NFR-3 (200 connections) were never measured.
- **No per-hop timing.** The 570 to 630 ms send-to-screen figure is end to end. I do not know how it divides between SNS, SQS, the realtime function and the socket post, and I will not claim a cause.
- **Small samples.** The latency figures come from 10 scripted runs, 20 curl samples and one QA session. The first-load figure of 6 to 10 s is observed, not sampled.
- **The ranking and the star table are my team's own judgement.** No one confirmed a priority list for us, and the data-correctness column and the modular monolith row are not from the book.
- **Availability is designed, not proven.** The 2 to 4 hour recovery time comes from reading the runbook, and the up-to-24-hour data loss from the backup schedule. No regional failover was ever run. Supabase and Neon failover were assumed from their own descriptions.
- **The end state was moving.** On the last day, closed-app push and the move of notification and ai to their own Neon projects were merged but not confirmed deployed. "17 functions deployed" depended on the hour of the check.
- **Gaps found by the QA run of 18 November** (receipts that updated only after a reload, two WebSockets per tab) were fixed in code but never re-run on the stack.

## If I did it again

- **Build the measurement in week two.** A k6 run from 200 to 2,000 sockets and a timer on each hop of the delivery path, before the features they judge. Without them, no later change to the event path could show that it helped.
- **Write a check that fails when a control is missing.** Our worst gaps were controls that existed in code and did nothing: an origin header that nothing read for a while, alarms with no e-mail target until 19 November, a rollback watch in CI that could not read the alarm, a structured logger no service imported. The import rules had such a check (`make lint-arch-verify` proves each rule still rejects a violation). Everything else should have too.
- **Count what a poll costs.** On a free tier, "every minute" is a budget line. D-145 taught that the hard way.
- **Make a later decision say which earlier rule it bends.** D-129 put two authorisation checks (blocks and the admin flag) on copies up to a minute old, which D-49 forbids for membership. The log never reconciled them.
- **Date every document.** The decision log changed with the code. The contributor guide and the architecture overview did not, and their counts were wrong when we read them.
- **Keep the style.** With the measurements above in hand, I would still pick serverless microservices for this budget and this brief. The ECS test showed the only gain of containers was the cold start, for money every month. What I would revisit, with per-hop timings first, is the length of the delivery path, which is where NFR-1 was lost.

## Sources

- Richards and Ford, *Fundamentals of Software Architecture*, O'Reilly, 2020 (characteristics, style ratings).
- Robert C. Martin, *Clean Architecture*, Prentice Hall, 2017.
- Simon Brown, The C4 model, https://c4model.com.
- Michael Nygard, "Documenting Architecture Decisions", 2011.
- Chris Richardson, "Pattern: Transactional outbox", https://microservices.io/patterns/data/transactional-outbox.
- My team's final report and slides (21 November 2026); the repository's requirements file (version 1.21), decision log (D-01 to D-191), architecture views of 15 November, and the capacity analysis of 20 November.

Written with Claude Code. Numbers checked against the sources above.
