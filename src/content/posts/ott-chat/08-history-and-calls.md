---
title: "History and calls: an archive tier on a branch, calls that cost nothing, group calls on paper"
description: "Moving old messages to S3 in checked chunks, 1-1 WebRTC calls signalled over the chat socket with a rented TURN relay, and why group calls stayed a plan."
pubDatetime: 2026-11-22T00:00:00Z
kind: series
series: ott-chat
part: 8
project: ott-chat
draft: false
tags: [realtime, reliability, aws, serverless, system-design]
---

This part covers three things at three levels of done. One-to-one calls were deployed on the dev stack but never tried there with a real call. A history archive was designed and started on a branch, not merged to main. Group calls were designed and not shipped. I label each one, because a plan is not a result.

## Key results

- **Calls cost $0 of our infrastructure.** Our servers carried only a few small signalling frames; audio and video went browser to browser.
- **TURN was rented, not run.** A relay we hosted would need an always-on server; Cloudflare's free tier filled the gap.
- **The archive moves 1,000 messages at a time.** Each chunk goes to S3 as one compressed file, checked by SHA-256 before the rows are deleted.
- **The archive never ran.** Only its schema was committed, behind a flag that is off by default.
- **Group calls: mesh first, SFU above 4 people.** The plan was written on 21 November and deferred.

## 1. History archive (designed and started on a branch, not merged)

![Archive flow, two lanes: a background archive job reads its flag from Parameter Store, selects 1,000 old messages of one conversation from Neon, writes them to S3 as a .jsonl.gz object and reads back its SHA-256, then in one transaction inserts the chunk row and deletes the rows; on the read lane, the web app asks for an older page, the chat Lambda finds the chunk and its overrides in Neon and fetches and decodes the chunk from S3.](./figures/aws-archive.png)
*The archive tier as designed (FR-3.11, D-194). Only the two tables exist in code, on a branch.*

**Problem.** Every message lived in one table on the free chat database, which was already our capacity limit ([Part 6](/posts/ott-chat/06-scale-latency-cost/)). Old messages are rarely read, yet they stayed in that table forever.

**Decision.** Move old history to S3 in chunks of 1,000 consecutive messages of one conversation. A message stays "hot" in Postgres for 30 days by default, 7 under pressure. The job writes a chunk as one `.jsonl.gz` object, reads back its SHA-256, and only then, in one transaction, inserts an index row and deletes the rows. A unique index on (conversation, first `seq`) makes a repeated run one chunk, not two. A chunk is never rewritten: a retraction after archiving goes into a small overrides table that the read path applies on top. Each chunk also lists its senders, so account deletion can find a person's messages.

**Cost.** Archived messages cannot be found by Postgres full-text search, and an old page needs an S3 read and a decode. The state is plain: one work-in-progress commit on 21 November with the migration and schema, marked "agent stopped, not reviewed or deployed". The flag in Parameter Store is off by default, so the migration alone changes nothing.

## 2. One-to-one calls: three parts of WebRTC

![One-to-one call: both browsers ask the chat Lambda for ICE servers (public STUN, and Cloudflare TURN whose key is read from Parameter Store); call frames travel over the WebSocket API to chat-ws, which caches routes for 10 seconds and uses DynamoDB for sockets and the first-answer claim, and relays them to the other browser; media goes peer to peer; the caller writes one call-log message to Neon.](./figures/aws-calls.png)
*Our servers see signalling only; the media never touches AWS.*

```text
 A ── ① signalling: offer, answer, candidates ──► chat WebSocket ──► B
 A ◄═════════ ② media: audio and video, peer to peer ══════════════► B
 A ◄═════ ③ TURN relay, only when the direct path is blocked ══════► B
```

A call has three parts, and they behave very differently. **Signalling** is a few small JSON frames, and the chat WebSocket already did that job. Chat-ws relays call frames only between the two members of a direct chat and stores nothing (D-153). A 10-second route cache avoids a database read per frame. If two devices of the callee both answer, one conditional write in DynamoDB lets the first one win (D-157). **Media** flows between the two browsers and never touches our servers. The call ends with one system message, written once by the caller, so the log shows up in the thread like any other message.

Limits protected the socket: 150 call frames per 10 seconds, 6 invites a minute, and a kill switch. Each frame is a short Lambda call, so a two-hour call is just a chain of small invocations.

## 3. TURN: rent the relay, don't run it

| Path | When | Cost to us |
|---|---|---|
| Direct, found with STUN | most networks | $0 |
| TURN relay, self-hosted | strict NAT, office firewalls | always-on server, about $3 a month at the cheapest, $5 to $10 realistic |
| TURN relay, Cloudflare | same | free tier |

**Problem.** Our design notes of late September put it at about 10 to 20% of calls that cannot connect directly. Those need a relay that forwards the whole media stream. Running one breaks three of our rules at once: it bills every month, it needs a public host with open UDP ports (no VPC was a rule), and it holds connections for hours, which Lambda cannot.

**Decision.** Rent it. Chat reads the Cloudflare TURN key from Parameter Store at run time and hands short-lived relay details to the browser, with a no-TURN fallback.

> **In plain words: a TURN relay**
> Two browsers first try to call each other directly, using a public STUN server to learn their own address. Some networks forbid that. Then both send their audio and video to a TURN server in the middle, which passes it across. It is a post office for media: slower and it costs bandwidth, but it always gets through.

## 4. What calls could not do

Calls worked only between two people and only while the callee had the app open. Ringing a closed app needs push, and that was not built for calls (FR-14.6). A read-only AWS check on 20 November found the call flag, the routes and the TURN parameters in place. But no QA run included a call, and we never ran one on the deployed stack. Local runs with fake devices connected in a few seconds. Behind a symmetric NAT, and in Safari and Firefox, the design is unproven.

## 5. Group calls (designed, not shipped)

![Two panels: in a mesh, four people each link directly to the other three, six links, and each sends three streams; with an SFU, each of four people sends one stream to a Cloudflare Realtime SFU that forwards it to the others, so each sends one and still receives three.](./figures/aws-groupcall.png)
*Mesh reuses the 1-1 code for small groups; an SFU cuts each person's upload to one stream.*

**Problem.** The 1-1 code assumed a pair: the peer came from the direct chat, the call log was written by the caller, and the frame limits were sized for two people. A 5-way mesh sends about 600 signalling frames in about 2 seconds, while our Lambda concurrency limit was still 10.

**Decision.** Mesh first: audio for up to 6, video for up to 4, reusing the chat socket and TURN at $0. An SFU on Cloudflare Realtime only when a call needs more than 4 people. In a mesh, a 720p stream at 1.5 Mbps means about 4.5 Mbps of upload per person at 4 people. The plan adds a room table in DynamoDB with a time-to-live, server-written call logs and a separate flag.

**Cost.** The estimate was about 15.5 engineer-days for mesh and 13.5 for an SFU, with real networks extra. On 21 November I decided group calls were not needed yet. Branches for mesh and SFU were created; a first slice of the mesh room model was started and never committed.

> **In plain words: an SFU**
> In a mesh, everyone sends their video to every other person, so four people each upload three copies. A Selective Forwarding Unit is a server in the middle: you upload once, and it copies your stream to the others. It forwards, it does not mix. The upload drops to one stream, but someone has to run or rent that server.

## Limits

- **The archive never ran.** No job code, test or S3 bucket for it exists on any branch I could read; the flow is from the schema comments.
- **No call on the deployed stack.** The checks were configuration, not a real call between two networks.
- **The 10 to 20% figure is an estimate** from a design discussion, not a measurement.
- **Group-call prices are unverified.** The plan says Cloudflare prices and endpoint names came from memory or search snippets.
- **Mesh numbers at 6 to 8 people are estimates**, not benchmarks.

## Sources

- Branch `feat/history-archive`: `services/chat/db/migrations/20261121100000_chat_message_archive.sql` and the store schema (FR-3.11, D-194).
- Final report §6.6 (pages 66 to 67); §2.2 (page 17).
- Repo `docs/decisions.md`: D-153, D-157, D-165; `docs/plan/group-call-plan.md` and `docs/plan/group-calls.md` (main).
- Owner's questions in `qa.md`: 26 September (how a video call would work), 21 November (mesh vs SFU, advanced features).
- Related: [Part 7, chat core](/posts/ott-chat/07-chat-core/).
