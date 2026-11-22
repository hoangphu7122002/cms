---
title: "Data and events: five databases, one topic, no lost copies"
description: "Why ott-chat used PostgreSQL on Supabase and Neon, a database per service, one SNS topic with a queue per consumer, an outbox, a saga and idempotent consumers."
pubDatetime: 2026-11-22T00:00:00Z
kind: series
series: ott-chat
part: 4
project: ott-chat
draft: false
tags: [event-driven, postgresql, microservices, system-design]
---

ott-chat split its data the way it split its code: each service owns its store, and services learn about each other through events. This part explains why we picked PostgreSQL, why it ran on two providers, and the patterns that kept copied data correct: an outbox, idempotent consumers and a saga.

## Key results

- **Five databases, one per service that has one.** Supabase for identity, one Neon project each for chat, analytics, notification and ai.
- **PostgreSQL, not MySQL (D-05).** Real schemas, native UTF-8, time zones and partial indexes, at the same price.
- **One SNS topic, seven SQS queues.** 16 event types. Each consumer has its own queue and dead-letter queue.
- **No lost copies.** Events that carry state go through a transactional outbox. A block reached chat in 0.4 s at the median, down from 59.4 s.
- **Order comes from the database, not the bus.** A sequence number at insert, a client message id and a per-handler ledger stop disorder and duplicates.
- **Account deletion is a saga** with no rollback step. The sign-in is removed last.

## 1. A database per service

![Eight service functions in Singapore, each pointing at its own store: identity at Supabase Postgres and Auth; notification, ai, chat and analytics at their own Neon projects (notification and ai added by D-184); realtime at a DynamoDB connections table; media at the S3 media bucket; moderation has no database and reads events only.](./figures/aws-services.png)
*Eight services, five databases. Realtime, media and moderation keep no Postgres.*

**Problem.** Until October 2026 one Supabase database held every schema, and every function logged in as the same user. "A service writes only its own schema" was a convention, and services read each other's tables. A change to a chat table could break analytics with no contract between them.

**Decision.** D-129 (29 October) gave each service its own Neon project. A service that has moved reads no other service's tables. What it needs, it keeps as a copy fed by events: chat keeps copies of users and blocks, analytics keeps users and conversations. There are no foreign keys anywhere, and rows are soft-deleted (D-104), so a schema can be lifted into another database whole.

**Cost.** Copies are eventually consistent. So the one check that decides who may read a conversation, membership, is chat's own table and is never read from a copy (D-49).

## 2. Why PostgreSQL, and why two providers

| | MySQL | PostgreSQL |
|---|---|---|
| Schema per service | separate databases | real `SCHEMA` inside one database |
| Emoji | needs `utf8mb4` on server, table and driver | UTF-8 by default |
| Time zones | no `TIMESTAMPTZ` | built in |
| Index on `deleted_at IS NULL` | no partial index | partial index |

The course brief listed MySQL. On 20 September I asked "why can't we use PostgreSQL?" The answer: we can, and it is technically cleaner. The only reason to stay was the list, and the report notes that the list was only a suggestion. So D-05 chose PostgreSQL, and every store we rented speaks it.

Identity stayed on **Supabase** because Supabase Auth keeps its users in the same Postgres: a trigger creates the profile in the sign-up transaction, so no account exists without a profile (D-36). The other services went to **Neon**: one free project each, scale to zero, 100 compute-hours a month. Supabase's free plan allows two active projects and pauses a project after seven idle days.

Vendor lock-in worried me, so I kept both providers boring. Both are plain Postgres. Our backup dumps plain table data, and the schema lives as migrations in git, so either database can be rebuilt on another host. The lock-in I did refuse was in auth: Cognito never exports password hashes ([part 5](/posts/ott-chat/05-aws-ha-security/)).

## 3. One topic, one queue per consumer

![Three publishers (identity relay, chat relay, chat Lambda publishing MessageSent inline) feed one SNS events topic with 16 event types. The topic fans out to seven SQS queues, each with a DLQ, feeding seven consumers: notification, chat, analytics, identity, media, moderation, realtime. Side notes: a ledger on (event_id, handler); a DLQ after 5 deliveries kept 14 days with an alarm; a new consumer is one new key in the consumers map.](./figures/aws-eventdriven.png)
*The event bus as built: one topic, no mediator, one queue and dead-letter queue per consumer.*

- **Shape.** 16 event types (10 from chat, 6 from identity) go to one SNS topic. Each of seven consumers has its own SQS queue, dead-letter queue and IAM role. Adding a consumer is one new key in a Terraform map; no producer changes.
- **Failure.** After five failed deliveries a message waits 14 days in its dead-letter queue, and an alarm e-mails the team. Redrive is manual: alarm, inspect, fix, deploy, redrive (D-57).
- **Cost.** With no filter, every consumer gets every event and ignores what it does not use: seven invocations per event. Only PresenceChanged, the most frequent, is filtered to realtime (D-181). We used Standard queues, not FIFO: FIFO has no free tier (D-48).

## 4. The outbox: no lost copy

![A service Lambda writes its row and an outbox row in one transaction to Postgres. An outbox relay, woken after a write with a one-minute schedule as a safety net, reads 100 rows with SKIP LOCKED and publishes to the SNS topic, which fans out to 7 SQS queues and 7 consumers that claim (event_id, handler) in a ledger. Failed messages go to 7 dead-letter queues; a CloudWatch alarm e-mails a person through the alerts topic.](./figures/aws-outbox.png)
*Outbox path: the event row is born in the same transaction as the change. The one-minute net shown is identity's relay; chat's relay polls hourly (D-145).*

Chat publishes `MessageSent` straight to SNS after the commit. If that publish fails, the client's next sync still shows the message, so best effort is fine. A lost `ProfileChanged` is different: chat's copy of that user stays wrong forever. So events that feed a copy go through an outbox (D-130). A trigger writes the event row in the same transaction as the change; a relay reads unpublished rows with `FOR UPDATE SKIP LOCKED`, publishes them, stops at the first failure and deletes rows older than seven days.

> **In plain words: the dual write problem**
> Saving a row and telling other services are two writes to two systems. If the save works and the message fails, nobody hears about it. The outbox puts a "notice" row in the same database transaction as the change: both happen or neither does. A separate relay posts the notices later, and keeps trying until it succeeds.

![A service Lambda updates a row and inserts an outbox notice in one Postgres transaction, then wakes the outbox relay; an EventBridge schedule also wakes the relay as a safety net; the relay takes unsent rows with FOR UPDATE SKIP LOCKED, publishes each to SNS and marks it sent](./figures/aws-outbox-wake.png)
*The outbox: one transaction, then a relay that wakes after the write, with a schedule as the safety net.*

How the relay wakes cost us real quota. A one-minute poll kept chat's Neon database awake and burned its 100 free compute-hours in 17 days (D-145), so chat's relay is now woken after each write and polls hourly. Identity's relay still polled each minute, and a block waited a median 59.4 s to reach chat. Waking it after each write cut that to 0.4 s (D-165).

## 5. Ordering and idempotency

| Risk | Guard |
|---|---|
| Messages out of order | server assigns `seq` at insert; client sorts by it (D-48) |
| Same send twice | unique `(conversation_id, client_msg_id)`; a retry gets the existing row (D-08) |
| Same event twice | each consumer claims `(event_id, handler)` in a ledger first (D-56) |
| Old snapshot after a new one | outbox events are full snapshots, applied newest-wins by `occurredAt` |

The bus never decides order. The first QA run on 17 November still found a bug: five fast sends showed as 4 1 2 3 5, because the web client sent them in parallel and whichever Lambda wrote first got the lower `seq`. The fix was in the client: one send at a time per conversation. The 18 November run sent the same client id twice and stored one message, and five fast messages kept their order.

> **In plain words: an idempotent consumer**
> SQS delivers "at least once", so a consumer can see the same event twice. Idempotent means doing it twice has the same effect as once. Each consumer first writes "I handled event X" into a ledger; if that row already exists, it stops. The key includes the handler name because three consumers receive the same event, and each must count it once.

## 6. Deleting an account: a saga

![Delete account flows from the web app through CloudFront and API Gateway to the identity Lambda, which in one Supabase transaction anonymises the profile, ends contacts, bans sign-in and writes a saga row. AccountDeleted leaves through the outbox to SNS, then 4 eraser queues and 4 erasers (chat, analytics, notification, media) that erase Neon data and S3 objects and report StepReported back. Identity removes auth.users last, when all four are done.](./figures/aws-saga.png)
*Account deletion as a choreographed saga, finished by identity.*

**Problem.** No transaction can span four Neon projects, Supabase, DynamoDB and S3.

**Decision (D-147).** Identity does its local part in one transaction and puts `AccountDeleted` in its outbox. Chat, analytics, notification and media each erase their own data and reply. Identity deletes the sign-in only when all four replies are in, so a half-done deletion leaves an account that cannot sign in, never data with no account. There is no compensation, because erased data cannot come back; a failed step shows in the admin list and an admin can re-send it.

**Cost.** Deletion is eventual. An access token already issued works for up to an hour, and messages stay in other people's threads as "Deleted user".

## Limits

- `MessageSent` and reactions are still a dual write. If SNS refuses a publish, the push, notification, statistic and second-tier moderation scan for that message are lost; sync only repairs what users see.
- One login per database: the schema boundary inside a shared database is held by review and lint, not by roles (D-100).
- The notification and ai Neon projects exist (D-184) but their cut-over was waiting for a deploy. Where their ledger lives after it was not decided.
- The saga ran end to end on the local stack only, never on the deployed stack.
- How much load the free databases carry is an estimate, not a test ([part 6](/posts/ott-chat/06-scale-latency-cost/)).

## Sources

- Final report: 3.3 to 3.4 (p25 to 26), 3.9 to 3.10 (p31 to 34), Table 11 (p28), Table 13 (p35), 5.1.7 (p50), 6.2 (p59 to 60), 6.10 (p72), 7.4 (p77), Table 23 (p79).
- Repo `docs/decisions.md`: D-05, D-36, D-48, D-49, D-56, D-57, D-129, D-130; `docs/plan/cognito-migration.md` section 1.
- Owner's Q&A notes: 20 September (PostgreSQL vs MySQL), 29 October (Supabase free projects), 21 November (outbox relay).
