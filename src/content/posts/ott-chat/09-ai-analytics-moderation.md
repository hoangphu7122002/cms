---
title: "AI, analytics, moderation and the apps: the features around the chat"
description: "An AI gateway with a spending cap, statistics built from events, moderation after send with a human review, and four clients from one web codebase plus Swift."
pubDatetime: 2026-11-22T00:00:00Z
kind: series
series: ott-chat
part: 9
project: ott-chat
draft: false
tags: [event-driven, mobile, serverless, aws, system-design]
---

Around the chat sat the features that make it a product: an AI that translates and summarises, statistics for users and admins, moderation, and the apps people actually open. Each one sits behind the event bus or a narrow seam, so it can fail without stopping a send. We tore the dev stack down on 22 November 2026.

## Key results

- **AI spend capped three ways.** $0.05 per user per day, $2 per day and $20 per month, reserved before the call.
- **AI cost was $0 so far.** The provider's free quota, not our cap, kept it there.
- **Statistics are lookups, never scans.** Events build small daily tables; the dashboard only reads them.
- **Moderation has two tiers and a person.** A word list blocks before the write, a consumer retracts after it, an admin reviews.
- **Four clients, two codebases.** Web, admin and Android share React code; macOS is native Swift; iPhone installs the web app.

## 1. AI behind a guard

![AI path: the web client calls chat through CloudFront and API Gateway; chat checks membership, anonymises speakers and calls the ai Lambda with a service token; inside ai the guard runs in order: kill switch and consent from Parameter Store, a 24-hour result cache by SHA-256, an atomic quota reservation, the Gemini call with a 12-second deadline and one retry, then settling the ledger; over a cap the user gets 429.](./figures/aws-ai.png)
*The order of the guard is the design: nothing reaches the provider before the switch, consent, cache and quota agree.*

**Problem.** AI was the only feature whose cost grew with use, and the only one that sent chat text to a third party.

**Decision.** The routes belong to chat (D-143). Chat checks membership, refuses messages from before the member joined, and replaces names with "Speaker 1", "Speaker 2". It caps input at 4,000 characters to translate and 200 messages to summarise, then calls the small ai service. Inside ai, the guard runs in a fixed order (D-142). The kill switch fails closed: if the parameter cannot be read, the feature is off. Consent is per user and per notice version. A cache keyed by a SHA-256 of the prompt answers repeats for 24 hours at no cost. On a miss, one transaction reserves the worst-case cost against the three caps. A reservation expires after 60 seconds, so a crash never locks the quota.

**Cost.** Three calls in a row (a cold chat, a cold ai and the provider) give latency a long tail.

> **In plain words: a kill switch that fails closed**
> A kill switch is a setting an admin can flip to turn a feature off without a deploy. "Fails closed" means: if the service cannot read the switch, it assumes off. For a feature that spends money, a broken settings store should stop the spending, not let it run.

## 2. What the AI cost

| | Value |
|---|---|
| Estimate, 3 October (OpenAI, small models, about 50 users) | about $1 a month |
| Small OpenAI model price in the decision log | $0.15 in, $0.60 out per million tokens |
| Actual bill | $0, the provider's free quota |
| Worst case | the monthly cap, $20 |

On 3 October I asked what OpenAI would cost. With nano and mini models, translate and summarise came to cents a month at our scale. The risk was a bug that loops on a big model, which can burn tens of dollars a day. So the cap went into code, not only into the vendor's dashboard. The provider sits behind a port with two adapters, OpenAI and Google. Dev ran Gemini (`gemini-3.5-flash-lite`), and switching was configuration, not code. The bill stayed at $0 because of Gemini's free quota, not because of our cap.

## 3. Analytics: events in, small tables out

![Analytics: on the write side, chat and the outbox relays publish to SNS, the analytics queue feeds a consumer that claims each event and updates rollup tables in its own Neon project; on the read side, the statistics page and admin dashboard call the analytics Lambda, which only looks up the rollups.](./figures/aws-analytics.png)
*The read side of a CQRS split: writes come from events, reads are lookups.*

Analytics owned its own Neon project and small pre-aggregated tables (D-46). A consumer takes up to 10 events at a time. For each one it inserts a claim row and increments the daily counts in the same transaction, so a redelivered event is never counted twice (D-56). The day comes from the event's own timestamp, so a backed-up queue does not shift counts to the wrong day.

The admin dashboard showed daily active users, sign-ups, messages per day, top groups, content types and reactions; the QA run of 18 November saw real data in all of them. A second round (D-150) added sent and received per user, engagement and hour of day. "Received" is computed at read time, because a write per member per message would be too expensive.

> **In plain words: CQRS**
> Command Query Responsibility Segregation means the side that writes data and the side that reads it are shaped differently. Here, events write counters; screens read finished totals. A dashboard never counts a million messages; it reads one row per day.

## 4. Moderation after send, and an admin who decides

![Moderation in three lanes: tier 1 checks banned terms inside chat before the INSERT; tier 2 is a moderation consumer that scans the first 140 characters of MessageSent and calls chat with a service token to retract; in review, the admin console approves or rejects a retraction and every decision is appended as an audit row.](./figures/aws-moderation.png)
*Tier 1 refuses before the write, tier 2 retracts after the acknowledgement, a person decides.*

**Problem.** A fully asynchronous check took about 3.5 seconds to retract, while delivery took about 4.0 seconds, so whether a bad message was seen was a race (D-116). A check fully in front of the write would make every send wait, and fail whenever moderation failed. Moderation was once down for a whole release and no sender noticed.

**Decision.** Two tiers. Tier 1 runs inside chat before the INSERT: a built-in check plus an editable list of banned terms (D-187), whole words only, cached for 60 seconds, failing open. Tier 2 is a consumer that scans the first 140 characters of each message and retracts a hit. The row keeps its `seq`, so no gap looks like a lost message. An admin then approves or rejects each retraction (D-152). Only "removed by mistake" puts the message back, and every decision is an append-only row. Admins can also lock an account: sign-in and refresh stop at once (D-126).

**Cost.** Text after 140 characters and all attachments go unseen by tier 2. A locked user's existing token still works for up to an hour.

## 5. The apps: one web codebase, one native

| Client | Built from | How it ships |
|---|---|---|
| Web | React and Vite | static files behind CloudFront |
| Admin | a separate web app | same |
| Android | Capacitor shell around the web build | a sideloaded APK |
| macOS | native Swift, SwiftUI (174 files, 413 tests) | `.app` signed with a self-made certificate |
| iPhone | the web app | added to the Home Screen as a PWA (D-188) |

On 20 October I asked how the app builds actually work. Android writes no Android code: build the web app, copy it into the shell (`cap sync`), then run Gradle to get the APK. Change the web UI and you repeat all three. The macOS app is a separate Swift package, layered like the services, and the build fails if a lower layer imports a higher one. It used Swift's own build tool, not Xcode, so it could not build for iPhone either. The iPhone got a PWA instead, which also avoided a $99-a-year App Store account.

> **In plain words: a Capacitor shell**
> Capacitor wraps a website in a thin Android app. Inside is a WebView, a browser with no address bar, loading our web files from the APK itself. Small plugins give the web code native powers: storing the token, the back button, the status bar. One codebase, two products.

## Limits

- **The AI features were not confirmed live.** The QA run of 18 November got 503 from the provider and was not re-run.
- **Kill-switch parameters are not in Terraform**, so the default was every AI feature on.
- **Statistics first load took 6 to 10 seconds** after idle (a cold start), and the claim table is never pruned.
- **A live retraction was not exercised** on the deployed stack; it rests on code and tests.
- **The Swift tests are not in CI**, and no client was tested on a real iPhone push.

## Sources

- Final report §5.1.4 to §5.1.6 (pages 48 to 50), §6.7 to §6.9 (pages 67 to 71), §7.8 (page 81), Table 2 (page 10), Table 22 (page 78).
- Repo `docs/decisions.md`: D-46, D-56, D-116, D-126, D-142, D-143, D-150, D-152, D-187, D-188.
- Owner's questions in `qa.md`: 3 October (OpenAI cost), 20 October (how the apps build).
- Related: [Part 4, data and events](/posts/ott-chat/04-data-events/), [Part 7, chat core](/posts/ott-chat/07-chat-core/).
