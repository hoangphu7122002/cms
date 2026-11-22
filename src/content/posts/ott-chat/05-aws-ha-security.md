---
title: "AWS, security and availability: what a $0 budget can protect"
description: "How ott-chat checked every request, why Supabase Auth beat Cognito twice, the availability it reached, and its daily backups, Sydney pilot light and Terraform."
pubDatetime: 2026-11-22T00:00:00Z
kind: series
series: ott-chat
part: 5
project: ott-chat
draft: false
tags: [security, reliability, aws, serverless, system-design]
---

The brief asked for security and an availability design, and our budget was $0 a month. This part shows what we protected, what we only planned, and how the infrastructure was written down as code. In short: strong checks on every request, daily backups that restore in a second region, and no automatic failover.

## Key results

- **One account, one region, one environment.** Everything ran in Singapore, and dev was the only environment (D-141).
- **Supabase Auth signs in, every service checks the token.** Cognito was rejected in September and again in November.
- **Seven security layers, six working.** The seventh, one database role per schema, stayed a gap (D-100).
- **Availability reached: zone level plus backups.** AWS covers the loss of one data centre; the Sydney standby compute was designed and deferred.
- **Backups restore every day.** Five databases dumped at 19:00 UTC and loaded into Sydney at 20:00 UTC. Estimated loss up to 24 h, recovery 2 to 4 h.
- **Two Terraform roots.** `live/dev` for Singapore and `live/dev-dr` for Sydney, each with its own state.

## 1. The AWS layout and who checks what

![Three request paths inside the Singapore region. HTTP: browser with the JWT in a header, CloudFront adds an origin header, API Gateway checks it, Lambda verifies the JWT and validates input, the use case checks membership, owner, admin and block, then Postgres. WebSocket: browser with the token in the URL to API Gateway WebSocket, chat-ws verifies the JWT and writes DynamoDB connection rows. Service call: the moderation Lambda calls chat through CloudFront and API Gateway with an X-Ott-Service-Token header. Numbers 1 to 7 mark the security layers.](./figures/aws-trust.png)
*Three paths into the system, with the layer that checks each hop.*

Nothing of ours ran on a server we managed. The edge was Route 53, two CloudFront distributions and two API Gateways. Behind them sat 17 Lambda functions, one SNS topic, seven SQS queues, DynamoDB, S3 and EventBridge schedules. Outside AWS we rented Supabase, Neon, the AI provider and a Cloudflare TURN relay for calls.

There was no VPC (D-42). A VPC protects things that listen on a port, and nothing here did. Because the databases sit outside AWS, a VPC would also force a NAT gateway at about $43 a month.

## 2. Sign-in: Supabase Auth, a JWT, and why not Cognito

| | Supabase Auth (kept) | Cognito (dropped) |
|---|---|---|
| Where users live | `auth.users`, a table in our Postgres | a directory outside our database |
| Profile creation | trigger in the sign-up transaction | needs a sync step that can fail |
| Leaving later | bcrypt hashes are portable | never exports password hashes |
| Availability | one free instance, no SLA | 99.9 % SLA, cross-region replication |

After sign-in the client held a JWT. Each service verified it itself with one shared function; there was no API Gateway authorizer. User ids came from the token, never from the request body.

> **In plain words: JWT**
> A JSON Web Token is a signed pass. After you sign in, Supabase gives you one with your user id and an expiry time. Anyone can read it, but nobody can change it without breaking the signature. Each service checks the signature with a public key, so it never has to ask Supabase "who is this?". The catch: a pass already issued stays valid until it expires, up to an hour.

Cognito came up twice. In September it lost because it keeps users outside the database, so a profile can be orphaned (D-36). On 29 October I asked to replace Supabase with Cognito for availability, and we wrote a plan: Cognito has a 99.9 % SLA and cross-region replication. The plan named its own price: lock-in, no local emulator, and a separate e-mail service. By 18 November it was off the table: about four to six days of risky work, and no real gain, because the databases stayed single points of failure anyway.

## 3. Security layers

| # | Layer (D-43) | State |
|---|---|---|
| 1 | CloudFront as the only public door | working |
| 2 | secret origin header | working after a fix |
| 3 | JWT checked in every service | working; the old shared-secret path is still reachable |
| 4 | rights checked in the use case | working |
| 5 | input validation, upload limits | working |
| 6 | one IAM role per function | working |
| 7 | one database role per schema | not built (D-100) |

Layer 2 taught the main lesson. For a while CloudFront added the header and nothing read it, so calling API Gateway directly worked just as well. A stated control is not a working one until something fails when it is missing.

A hardening batch on 19 November added nine changes for about $0: HTTPS-only buckets, row-level security that blocks the public Supabase key, certificate checks on Neon, an encrypted topic, alarms that e-mail a person and a $5 budget alarm. Secrets live in SSM Parameter Store, gitleaks scans every commit, and CI has no stored AWS key. One gap remains: Terraform copies several secrets into Lambda environment variables and its state file. A web firewall (about $8 to $10 a month, D-45) was left out; API Gateway throttles and per-user limits bound abuse instead.

## 4. The availability we actually reached

![High availability design. Singapore primary: regional services (API Gateway, 17 Lambda functions, SNS, SQS, DynamoDB, S3, CloudWatch) are multi-AZ by AWS design; Supabase and Neon primaries in zone a with standbys in zone b marked assumed. A backup Lambda writes daily at 19:00 UTC to a versioned S3 bucket replicated to Sydney. In Sydney, Supabase and Neon standbys are loaded daily at 20:00 UTC, while a Sydney stack of Lambda, API Gateway, SQS, SNS and DynamoDB is drawn in red as a target, not built. Five failure scenarios: AZ loss, database failover, Lambda throttling, poison message, region loss with manual cut-over, RTO about 2 to 4 h and RPO up to 24 h.](./figures/aws-ha.png)
*Green is built, red dashed is designed but not built, purple dotted is assumed on the provider side.*

On 18 November I asked "what HA level do we have now?" The honest answer was zone level, which AWS gives managed services for free, plus a daily backup. If Neon or Supabase failed, the app stopped until they recovered.

We then added a copy of the data in Sydney, kept fresh daily. What we did not build: Sydney compute, automatic failover, Route 53 health checks, or a second environment. The design for those is drawn, priced (about $3 to $5 a month in our plan) and deferred. Free Neon and Supabase plans have no cheap cross-region replica, and active-active would double the bill.

> **In plain words: pilot light**
> The name comes from a gas stove: a tiny flame always burns, so the big burner lights at once. In disaster recovery, the "flame" is the data: it is kept alive in a second region. The servers stay off and are built only when the main region dies. Ours was a very small flame: daily copies, not live replicas.

## 5. Backups and restore

![Backup flow: Supabase identity and four Neon projects are dumped by a backup Lambda at 19:00 UTC to a versioned private S3 bucket in Singapore, one gzip per table plus a manifest. Cross-region replication copies it to S3 in Sydney. A restore Lambda at 20:00 UTC loads the newest complete dump into Sydney standbys: Neon chat 9 tables, 800 rows, 11 s; Neon analytics 11 tables, 559 rows, 13 s. First restore run: 0 tables failed, a second run is idempotent.](./figures/aws-backups.png)
*Five databases dumped, replicated and restored every day (row counts from the first run, 19 November).*

**Problem.** Supabase Free has no backups, and Neon Free restores only six hours back, in place.

**Decision (D-151, D-162).** A Lambda dumps every database daily and writes the manifest last, so no manifest means no backup. A restore function reloads Sydney every day, which doubles as a drill. The first run, on 19 November, loaded supabase (17 tables, 1,819 rows, 20 s), chat and analytics with no table failed.

**Cost.** A later run failed with "column does not exist": migrations had been merged after the restore function was last deployed. The backups were fine; the standby was stale until a redeploy on 20 November. A failover is a person following a runbook. Everyone signs in again, because a new Supabase project has new token keys. Sydney's idle cost was under $0.01 for storage plus about 0.7 of Neon's 100 free compute-hours.

## 6. Terraform roots and the pipeline

![Terraform layout: config supplies names, the ott- prefix and the SSM path to live/dev, which calls 11 modules (service, http-api, frontend, media, websocket-api, event-bus, scheduled-function, keepalive, backup, dr-restore, replica-bucket); bootstrap holds the state bucket and OIDC role and is applied once by hand. A box counts 145 resources, 17 Lambdas on nodejs22.x arm64 behind a live alias.](./figures/aws-terraform.png)
*The Terraform modules behind live/dev. The Sydney root is separate.*

| Root | Region | State bucket | Holds |
|---|---|---|---|
| `terraform/live/dev` | ap-southeast-1 | Singapore | the running stack |
| `terraform/live/dev-dr` | ap-southeast-2 | Sydney | replica buckets only |

Why a stack at all: a recovery region needs hundreds of resources, and nobody types those by hand during an outage. Why a second root: if Singapore is down, so is the state of `live/dev`, and you cannot plan or apply. `live/dev-dr` keeps its state in Sydney, and a failed apply there cannot touch the live stack.

Terraform owns the infrastructure; CI ships the code (D-70). A deploy publishes a function version and moves its `live` alias, so a rollback takes seconds. GitHub Actions log in through OIDC (a short-lived identity token from GitHub) with no stored key and cannot apply Terraform (D-78). From 27 October to 20 November, 101 of 117 deploy runs succeeded. Then GitHub billing blocked the jobs, and deploys went back to the same script by hand.

## Limits

- No failover was ever run. The 2 to 4 h recovery time comes from reading the runbook; the 24 h loss from the schedule.
- Provider-side zone failover for Supabase and Neon is assumed, not tested.
- The shared-secret token path and secrets in Lambda environments remained open.
- The edge throttles were never exercised on the deployed stack.
- In CI the automatic rollback never fired: the role could not read the alarms, and the script skipped the check quietly.

## Sources

- Final report: 3.5 to 3.7 (p26 to 29), 5.1 to 5.2 (p46 to 54, Tables 19 and 20), 7.1 to 7.3 (p73 to 76).
- Repo `docs/decisions.md`: D-36, D-42, D-43, D-45, D-141; `docs/plan/cognito-migration.md`; `terraform/live/dev-dr/backend.tf` (PR #232).
- Owner's Q&A notes: 29 October (Cognito plan, VPC), 18 November (HA level), 19 November (pilot light, backup and restore, why a stack, root `live/dev-dr`), 21 November (JWT).
