---
title: "Chat core: one send, a socket push and a cursor that repairs every gap"
description: "How ott-chat sent a message, pushed it over a WebSocket, showed sent, delivered and seen, kept devices in sync, and planned push for closed apps."
pubDatetime: 2026-11-22T00:00:00Z
kind: series
series: ott-chat
part: 7
project: ott-chat
draft: false
tags: [realtime, event-driven, serverless, aws, system-design]
---

This part follows one message from the sender's keyboard to the other screen. The rule behind every choice: the live push may fail, so the catch-up must be correct. We tore the dev stack down on 22 November 2026, so this is the system as built and measured.

## Key results

- **The sender waits for one INSERT.** The acknowledgement came back in 113 ms at the median; fan-out happened after it.
- **Live delivery missed its target.** Send to the other screen took a median of 626 ms over 10 scripted runs, against a 200 ms goal.
- **No duplicate, no lost order.** A retried send returned the same row, and a QA run delivered 16 of 16 messages live.
- **One cursor repairs everything.** A device that missed frames, or was offline for a week, made one `/sync` call.
- **Receipts are two numbers per member.** Sent, delivered and seen come from two cursors, never from per-message rows.
- **Closed-app push was coded, not proven.** FCM for Android and Web Push for iPhone were merged in the last two days and never seen arriving.

## 1. Why a WebSocket at all

| | Poll every 3 s | WebSocket |
|---|---|---|
| Correctness | same | same |
| Delay | 0 to 3 s | about 100 ms |
| After being offline | `/sync?since=` | `/sync?since=`, still needed |
| New infrastructure | none | WebSocket API, DynamoDB, reconnects |
| Tickets in our plan | 1 | 7 |

**Problem.** On 25 September I asked why we needed a WebSocket at all. Nobody had argued it. FR-3.1 says an online recipient sees the message "without reloading", and polling every 3 seconds meets that sentence. The catch-up endpoint (FR-9.3) had to exist anyway.

**Decision.** We chose the WebSocket. It buys no correctness, only speed, but in a chat app speed is the product. It cost nothing at idle: API Gateway holds the sockets, so there is no server to pay for (D-02).

**Cost.** Seven tickets instead of one, a table of live connections, and a reconnect path to get right.

> **In plain words: a WebSocket, and who does what**
> A normal web request is a phone call that hangs up after one answer. A WebSocket keeps the line open, so the server can speak first. API Gateway holds the line. In restaurant terms: `chat-ws` is the receptionist who writes "user X is at table Y" in a book (DynamoDB) and crosses it out when they leave. `realtime` is the waiter who reads the book and carries each new message to the right table.

## 2. The send: acknowledge after one write

![Send path: the web app POSTs through CloudFront and API Gateway to the chat Lambda, which checks the rate limit and membership, inserts into Neon Postgres and acknowledges; after the commit it publishes MessageSent to SNS, which fans out to consumer queues for realtime, notification, analytics and moderation.](./figures/aws-send.png)
*The sender waits only for steps 1 to 4; everything on the dashed path happens after the answer. The figure's "D-130" on step 5 is loose: `MessageSent` is published directly, not through the outbox.*

The client draws the message at once as "sending", with a `clientMsgId` made on the device. Chat checks a per-user rate limit, live membership in its own table, blocks and banned words. Then one INSERT with `ON CONFLICT (conversation_id, client_msg_id)`: a retry after a lost answer gets the existing row back (D-08). The order number `seq` comes from the database, never from arrival time (D-48).

After the commit, chat publishes `MessageSent` to SNS and answers 201. The sender's wait does not grow with the group, because fan-out is a consumer's job (FR-4.4, D-07). The price is a dual write: the publish is best-effort, not in the outbox. If SNS refuses it, the message is stored but no live push goes out. The next sync still shows it.

## 3. Live push, and the cursor that repairs gaps

![Three lanes: connect (browser opens wss with the token in the URL, chat-ws verifies the JWT and stores a connection row in DynamoDB), push (MessageSent reaches the realtime queue, the realtime Lambda looks up member sockets and posts one frame per socket), and gap (after a reconnect the client calls GET /sync on the chat Lambda).](./figures/aws-realtime.png)
*The push is fast and allowed to fail; the `/sync` lane underneath makes losing it safe.*

**Push.** Each tab opens one socket (D-111). A browser cannot set a header on a WebSocket, so the token rides in the URL and `$connect` checks it (D-110). A connection row lives 24 hours and a heartbeat every 60 seconds refreshes it. The realtime consumer posts one frame per socket of every member; a 410 answer means the browser vanished, and the row is forgotten.

**Catch-up.** When the socket drops, the client retries after min(30 s, 500 ms × 2ⁿ), so a flaky network does not become a storm. Back online, it calls `GET /sync?since=<cursor>&limit=100` (D-119). One query joins the caller's memberships to every message whose `seq` or `changed_seq` is above the cursor. Edits, retractions and reactions bump `changed_seq`, so a changed message comes back whole. Because `seq` is one counter for the whole table, one cursor per device covers every conversation. That is what made multi-device sync cheap.

**The browser cache.** On 28 September I asked why every reload showed "Loading…". Everything lived in tab memory. D-119 moved it to IndexedDB: up to 200 messages per conversation, one database per user, deleted on sign-out. The app paints from disk, then asks `/sync` for the difference, saving messages before the cursor.

## 4. Sent, delivered, seen

![Receipts lane: the recipient device sends PUT /delivered or /read with a seq, chat updates two cursors on conversation_members in Neon and publishes an event that reaches the sender's socket through SNS, SQS and the realtime Lambda; a typing lane shows chat-ws relaying typing frames and storing heartbeats in DynamoDB.](./figures/aws-receipts.png)
*Two cursors per member give a status, never a time; typing is relayed and never stored.*

Each member has `last_delivered_seq` and `last_read_seq` (D-166). A device that stored a message says so; reading lifts both. Each update is `greatest(old, new)`, so a replay or a late lower number changes nothing. The frame carries the new mark, not a difference, and goes to every device of every member, including the reader's other devices, so their unread badge clears.

The status is computed on the client: sent when the server stored it, delivered when the other device stored it, seen when the other person read it. In a group, all other members must reach it. Rows grow with members, not with messages times members (D-09). A user can switch receipts off (D-173). Typing never touches the bus: at most one frame per 3 seconds, none in groups of 10 or more (D-11).

## 5. Who is online

![Friends online: the web app pulls GET /presence/friends once; chat-ws publishes PresenceChanged on a first connect or last disconnect with an 8-second debounce; SNS routes it only to the realtime queue; realtime pushes a presence frame to online, eligible friends, who also re-pull every 60 seconds.](./figures/aws-presence.png)
*Pull once, push on change, re-pull every minute as the safety net.*

The first version was pull only (D-10). QA saw presence correct in the API and invisible in the screen, so D-181 added a push. Chat-ws emits `PresenceChanged` only on a person's first connection and last disconnection, with an 8-second debounce so a reload does not flap the dot. It is the busiest event on the bus, so an SNS filter sends it to the realtime queue only. Blocks and the privacy toggle apply in both directions.

## 6. When the app is closed

| | FCM (Android app) | Web Push (iPhone, browsers) |
|---|---|---|
| Decision | D-189, merged 20 Nov | D-191, merged 21 Nov |
| Needs | Google Play Services | iOS 16.4+, added to Home Screen |
| Price | free | free |

A closed app holds no socket, so a frame cannot reach it. The Android app is a WebView with no service worker, so it needs FCM; the iPhone app is a PWA, so it gets Web Push. Both were hand-written on `node:crypto` with keys in Parameter Store, under one rule set: never the sender, a muted chat, a block or a person with an open socket. The macOS app showed only local notifications, because Apple's push needs a $99 developer account.

> **In plain words: FCM and Web Push**
> Your phone keeps one always-open line to Google (or your browser to its vendor). When a message comes, our server does not call your phone; it hands a small note with a device token to Google's service, which drops it down that line. On iPhone the web app must be added to the Home Screen first, then allowed to notify.

## Limits

- **No per-hop timing.** The 626 ms is end to end; I cannot say how it splits between SNS, SQS, Lambda and the socket post.
- **QA gaps fixed but not re-run.** The 18 November run found no live read frame and two sockets per tab; both were fixed on main and never re-measured.
- **Push unverified.** Nobody saw a push arrive on a device; deploy state of the notification function depended on the hour of the check.
- **A cursor edge case.** Two transactions committing out of order could let a sync skip a `seq`. No test covers it.
- **The send event is best-effort.** A refused publish loses the live push, the notification and one analytics count.

## Sources

- Final report §6.2 to §6.4 (pages 59 to 64), §8.5.1 (page 86); latency Table 21 (page 55).
- Repo `docs/decisions.md`: D-02, D-07, D-08, D-09, D-10, D-11, D-48, D-110, D-111, D-119, D-166, D-173, D-181, D-188, D-189, D-191.
- Owner's questions in `qa.md`: 25 September (why WebSocket), 28 September (browser cache), 20 November (Web Push, FCM, laptop), 21 November (chat-ws).
- Related: [Part 4, data and events](/posts/ott-chat/04-data-events/), [Part 6, scale and latency](/posts/ott-chat/06-scale-latency-cost/).
