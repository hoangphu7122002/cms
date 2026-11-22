import type { CollectionEntry } from "astro:content";
import config from "@/config";

/**
 * Determines whether a post is eligible to be listed/rendered.
 *
 * - Excludes drafts always
 * - In production, excludes scheduled posts until `pubDatetime` minus the configured margin
 * - In dev, always shows non-draft posts to make authoring easier
 * - In dev with SHOW_DRAFTS=true, also shows drafts (private local preview; never in a build)
 */
export function postFilter({ data }: CollectionEntry<"posts">) {
  const isPublishTimePassed =
    Date.now() >
    new Date(data.pubDatetime).getTime() - config.posts.scheduledPostMargin;
  const showDrafts = import.meta.env.DEV && process.env.SHOW_DRAFTS === "true";
  return (showDrafts || !data.draft) && (import.meta.env.DEV || isPublishTimePassed);
}
