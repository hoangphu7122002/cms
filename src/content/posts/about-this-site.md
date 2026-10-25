---
title: "About this site: four kinds of posts"
description: "How the hub files its posts, who writes them, and how the numbers are checked."
pubDatetime: 2026-10-25T10:00:00+07:00
author: "Hoang Phu"
kind: method
tags:
  - meta
---

This site collects what we learned while building and measuring software, starting with an LLM serving endpoint tested on L4 GPUs. Every post is one of four kinds.

| Kind        | What it is                                                 | Example                                         |
| ----------- | ---------------------------------------------------------- | ----------------------------------------------- |
| `series`    | The ordered story of one project                           | Serving LLMs on L4, in 11 parts                 |
| `concept`   | An explainer that does not depend on one project's numbers | KV cache and paged attention                    |
| `fieldnote` | One wrong turn or trap, about 1,000 words                  | A token budget that made TensorRT-LLM look slow |
| `method`    | How we work, not what we found                             | Measuring honestly with paired runs             |

## How the posts are made

The posts are written with Claude Code. Each number in a post is traced to a run id or a changelog step in the project repository, a script checks the numbers and looks for leaked keys, and a separate reader reviews every post against its sources before it appears here.

## Where the posts live

A post lives next to the code and results it describes. This repository only holds the posts that have been reviewed and approved; a sync script copies them in.
