---
title: "ott-chat, the codebase: domain-driven design in a pnpm monorepo"
description: "Services cut by business domain, four layers inside each, import rules that fail the build (0 forbidden among 2,108), and how a new consumer is added."
pubDatetime: 2026-11-22T00:00:00Z
kind: series
series: ott-chat
part: 3
project: ott-chat
draft: false
tags: [ddd, system-design, microservices, typescript]
---

[Part 2](/posts/ott-chat/02-architecture-style/) chose microservices on Lambda. This part opens the repository: how four people changed one TypeScript monorepo every week and kept the services apart. My answer was domain folders at the top, clean layers inside each service, and a build that fails when anyone crosses a line.

## Key results

- **Folders by business area, not by layer.** `services/chat`, `services/identity` and six more; never `controllers/` or `models/`.
- **Four layers in every service.** domain, application (use cases and ports), adapters (inbound and outbound), entrypoints (one per Lambda).
- **One public door.** Only a service's `contract/` folder may be imported from outside. No OpenAPI file.
- **Rules the build enforces.** 0 forbidden imports among 2,108, and a script that proves each rule still fires.
- **The partition fit the work.** 279 of 353 code commits (79%) touched exactly one area.
- **A new consumer is 10 lines of Terraform.** The producer does not change.

## 1. Services cut by business area

![Context map: seven services, each listing what it owns and its store; identity and chat publish to one SNS topic; realtime, notification, analytics and moderation consume; chat calls ai over HTTP, moderation calls chat to retract, chat imports moderation's pure policy function; a red label marks the chat and identity contract cycle](./figures/ddd-context-map.png)
*The contexts, what each owns, and how they meet: events, HTTP calls and imports of another service's `contract/`.*

**Problem.** Four people, nine weeks, one repository, everyone touching code every week. Two features had to land without editing the same folders.

**Decision.** Our architecture decision record ADR-001 uses three ideas at three levels: folder names that say what the business does at the top, clean architecture inside a service, and closed layers inside that. It is one pnpm workspace with `kernel`, `platform`, `services/*` and `clients/*`. Each service is what domain-driven design calls a bounded context: one model, one owner of its data, one vocabulary. The repository says "service", and keeps the vocabulary in `GLOSSARY.md`, because *retract* is not *delete*.

Chat is the core and the largest: it owns conversations, members, messages, reactions and read state. It is big on purpose. Membership must sit with the messages it guards, because "a permission check must never read replicated data" (D-49).

## 2. Inside one service: four layers

![Folder layers of one service: entrypoints at the top, inbound and outbound adapters below, application with use cases and ports, domain at the bottom, all inside a private internal/ folder; contract/ and tests/ outside; black arrows are allowed imports, red dashed arrows marked 1 to 5 are forbidden](./figures/ddd-service-layers.png)
*One service's folders. Black arrows are allowed; red ones fail the build.*

The use case declares the ports it needs in `ports.ts`, "never beside their implementations" (D-62). An adapter plugs into a port. The entrypoint builds the database pool and the AWS clients once per Lambda container and wires them in. Two shared packages sit outside: `kernel` (pure: `Result`, errors, ids) and `platform` (HTTP kit, JWT, Postgres, logger), which only adapters and entrypoints may import.

> **In plain words: inbound vs outbound adapter**
> The difference is who calls whom. An inbound adapter is the waiter taking orders: HTTP, a socket or a queue calls in, and the adapter turns the raw request into a use-case call. An outbound adapter is the person sent to market: the use case says "store this message" through a port, and the adapter does it with Postgres, SNS or S3. A queue consumer is inbound (SQS pushes to us); the SNS publisher is outbound (we push out).

![API Gateway calls http/handlers.ts, the inbound adapter, which calls sendMessage() in the application; sendMessage calls ports.messages.send(), a port in application/ports.ts; message-repository.ts in the outbound adapter implements that port and INSERTs into Neon](./figures/aws-ports.png)
*The inbound adapter knows the use case; the use case knows only the port.*

## 3. One send, through the layers

| Step | File | Job |
|---|---|---|
| 1 | `entrypoints/http/lambda.ts` | wire repositories, SNS publisher, clock once |
| 2 | `adapters/inbound/http/handlers.ts` | check the caller, parse the body, call the use case |
| 3 | `application/send-message.ts` | conversation exists, sender is a member, no block, banned-term check |
| 4 | `adapters/outbound/store/message-repository.ts` | INSERT; a repeated `client_msg_id` returns the original row |
| 5 | `adapters/outbound/events/event-publisher.ts` | publish `MessageSent` to SNS |

The use case takes seven ports plus a clock, the most of any use case (the mean is about two). Every function returns `ok` or `err` instead of throwing, so the failure path is part of the signature. Because the use case sees only ports, a unit test passes in-memory fakes and runs with no database and no AWS. The same property let a local dev server run four services' HTTP apps in one Express process.

## 4. Contracts, not OpenAPI

**Problem.** Realtime must parse chat's `MessageSent`; the web app must know what a send returns. If services import each other's code, a refactor in one breaks the others.

**Decision.** Each service's `contract/` holds its API types (`contract/api/`) and the schemas of the events it publishes (`contract/events/`, D-61). Clients import the API types directly (D-68). Measured: 31 imports from one service into another, all into `contract/`, 27 of them type-only; clients import contracts 124 times and never touch `internal/`.

> **In plain words: why not OpenAPI?**
> OpenAPI is a file describing an HTTP API, so tools can generate client code and block breaking changes. Its strongest reason is an installed app you cannot force to update: rename a field and every old copy breaks. Our web, admin and Android clients share TypeScript, so they import the types and the compiler catches the rename. That covers the common bug for free, so we deferred OpenAPI until a packaged app needed it.

**Cost.** The deferral had a blind spot. By the end two packaged apps existed, Android and the Swift macOS app, and no spec was ever written. The Swift models "mirror" the TypeScript contracts by hand; versioned `/v1/` paths (D-14) were their only guard.

## 5. Rules the build enforces

![Import counts between layers summed over seven services: application to domain 115, inbound adapters to application 75, outbound adapters to application 48, application to contract 44; the forbidden arrows, application to adapters and domain to application, measure 0](./figures/fig-ch06-layers.png)
*File-to-file imports between layers. The crossed arrows are forbidden and measure 0.*

A folder called `internal/` is a request, not a wall; TypeScript compiles any import. So dependency-cruiser fails `make lint` on five rules:

1. `domain` imports nothing but the standard library and the kernel.
2. `application` never imports `adapters`.
3. Adapters never import each other.
4. No service touches another service's `internal/`.
5. `application` never imports `platform`.

A sixth keeps the AWS SDK in outbound adapters and entrypoints. On the measured code, dependency-cruiser saw 653 modules and 2,108 imports with 0 errors.

The rules failed silently twice. Once, excluding `node_modules` hid every edge to a package, so `domain` could import a database driver unseen. Once, new `@` aliases made imports unresolvable, and an unresolved import is a missing edge, not an error. Since then `make lint-arch-verify` writes a deliberate violation for each rule and checks that it is rejected. One more cost: GitHub Actions became unavailable on the account (billing), so the real gate was a local pre-push hook and `make ci-full`.

## 6. Adding a consumer: Terraform, code, deploy

![Four steps: 1 Terraform adds about 10 lines to event-bus.tf and creates the queue with DLQ, alarm, log group, role and a placeholder Lambda; 2 code in services/realtime; 3 LocalStack init adds the queue; 4 deploy-service.sh bundles, publishes a version, moves the live alias, smoke tests and watches the errors alarm for 10 minutes, moving the alias back on failure](./figures/aws-add-consumer.png)
*Adding the realtime consumer: infrastructure first, code second, deploy with an automatic rollback.*

**Terraform first.** The event-bus module builds everything per key of a `consumers` map, so the realtime consumer was a 10-line entry. Terraform creates the function with a placeholder zip and never deploys code; CI owns code (D-70).

**Then code.** This is the real work: a full service with the same four layers. The inbound SQS adapter turns the raw queue record into chat's `MessageSent` type, imported from chat's contract, so the use case never knows it runs on SQS. A broken message is reported back alone, so the other nine in a batch of ten finish.

**Then deploy.** One script publishes a new version and moves the `live` alias; a rollback is one API call. Chat did not change, except to delete the fan-out it no longer did. Four consumers of `MessageSent` were added this way. The gap: the CI deploy list first knew only identity and chat, so consumers were deployed by hand until rows were added.

## Limits

- **One snapshot.** The import and commit numbers come from the report's scripts on a commit with seven services; media and later work are not in them, and I did not rerun them.
- **I did not run `make lint-arch-verify` for this post.** It writes probe files into the repository.
- **The contexts leak a little.** chat-ws writes the connections table realtime reads, and three consumers share one `processed_events` table.
- **Metrics describe structure, not fitness.** Nobody lifted a service out to prove it could be.

## Sources

- Repository: `docs/ADR/ADR-001-codebase-architecture.md`, `docs/decisions.md` (D-14, D-49, D-61, D-62, D-68, D-70), `GLOSSARY.md`, `.dependency-cruiser.cjs`, `scripts/verify-arch-rules.sh`, `terraform/live/dev/event-bus.tf`, `scripts/deploy-service.sh`, `clients/macos/Sources/OttDomain/`.
- Final report: chapter 4 (codebase, metrics) and its data files; §3.4 (adding a consumer).
- Owner's questions of 21 September (OpenAPI), 26 September (adding a consumer) and 21 November (inbound vs outbound).
- Robert C. Martin, *Clean Architecture*, 2017; Eric Evans, *Domain-Driven Design*, 2003.
