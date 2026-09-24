# Markaestro MCP tools

Every tool returns JSON text. Failures come back as an error result whose
first line is `CODE (HTTP status): message`, followed by per-channel issues
and a hint. Ids are opaque strings; copy them exactly.

## Discovery

**`get_channel_rules`** `{}` → `{ rules, keyMode: "live" | "test", baseUrl }`

**`list_products`** `{}` → `{ products: [{ id, name, channels: [...] }], count }`
The list has one entry: the brand this key is bound to.

**`list_destinations`** `{ productId }` →
`{ destinations: [{ id, channel, provider, label, deliveryMode, ... }], count }`
Needed only when one channel has several accounts (two Facebook Pages, say).

## Posts

**`list_posts`** `{ status?, limit? (1-100), cursor? }` → `{ posts: [...], nextCursor }`
Statuses: `draft`, `scheduled`, `publishing`, `published`,
`platform_action_required`, `failed`, `partial_failed`.

**`get_post`** `{ postId }` → `{ post }`
A post carries `status`, `caption`, `targets[]`, `mediaAssetIds`,
`scheduledAt`, `publishedAt`, `externalUrl`, `publishResults[]`, `nextAction`.

**`create_post`**
```json
{
  "caption": "Launch day.",
  "targets": [
    { "channel": "linkedin" },
    { "channel": "instagram", "deliveryMode": "direct_publish",
      "settings": { "__type": "instagram", "postType": "feed" } }
  ],
  "mediaAssetIds": ["ast_123"],
  "scheduledAt": "2026-09-10T14:00:00Z"
}
```
→ `{ post, note }`. Without `scheduledAt` the post is a draft. For one channel
use `channel` (plus optional `destinationId`, `deliveryMode`, `settings`)
instead of `targets`. Never send both.

**`create_posts`** `{ posts: [ ...up to 25 create_post bodies ] }` →
`{ results: [{ ok, post } | { ok: false, error }], created, total }`

**`publish_post`** `{ postId }` → `{ run: { id, status, ... } }`
Publishes now. Poll `get_job_run` with `run.id`.

**`delete_post`** `{ postId, platform? }` → `{ deleted: true, id, source, platform: { channels, skipped } | false }`
`platform: true` also takes a published Markaestro post down from every
channel it went to (needs `posts.publish`); the record goes only once every
live copy is gone, and a failure names the channel and what already went.
A native post id (from `list_post_analytics`, `source: "native"`) is always
taken down from the platform. Instagram and TikTok offer no delete to
apps: they are never attempted, a takedown lists them under `skipped`
with the copy still up, and a native post there answers `UNSUPPORTED`
(400). Rows carry `canTakeDown`; do not offer a takedown when it is false.
`PLATFORM_POST_NOT_FOUND` (404) means the platform no longer has it;
`CONNECTION_AUTH_ERROR` (409) means reconnect.
Cancels a scheduled post or removes a draft. A published post is only
forgotten by Markaestro; the live copy stays on the platform.

**`bulk_posts`**
`{ ids: [...], action: "reschedule", scheduledAt }` or
`{ ids, action: "delete" }` or `{ ids, action: "status", status: "draft" | "scheduled" }`
→ `{ succeeded: [ids], failed: [{ id, error }] }`

## Media

**`upload_media`** `{ source, fileName?, contentType? }` → `{ asset: { id, type, url, width, height, ... } }`
`source` is a local path, an http(s) URL, or a `data:` URL. The type is
inferred from the extension when `contentType` is omitted.

**`list_media`** `{ type?: "image" | "video", limit?, cursor? }` → `{ assets: [...], nextCursor }`

**`get_media`** `{ assetId }` → `{ asset }` with `processingState` and `refCount`.

## Intelligent Evergreen

**`preview_evergreen_queue`** `{ sourcePostId }` → eligibility evidence and a recommended cadence. Read-only.

**`create_evergreen_queue`** `{ sourcePostId, name, variants, channels?, intervalDays?, timeZone?, localHour?, localMinute?, scheduleMode?, reviewPolicy?, expiresAt? }` → a draft queue.

**`get_evergreen_queue`**, **`list_evergreen_queues`**, and
**`list_evergreen_runs`** read policy and occurrence history.

**`get_evergreen_analytics`** returns source metrics, queue-lifetime metrics,
tracked clicks, conversions, and recent run outcomes. Unavailable provider
metrics remain `null`.

**`update_evergreen_queue`** requires the current `version`, preventing a stale
client from overwriting someone else's edit.

**`activate_evergreen_queue`** schedules future occurrences. Confirm with the
user first. **`pause_evergreen_queue`** unschedules the pending occurrence,
**`resume_evergreen_queue`** computes a fresh next run, and
**`archive_evergreen_queue`** ends the queue permanently.

## Analytics (needs the `analytics.read` scope)

**`get_analytics`** `{ days?, since?, until?, channel?, source?, tz? }` → `{ analytics: { window, totals, daily, priorDaily, dailyActivity, breakdown, followerTrend, channels, leaderboard, heatmap, contentTypes, insights, coverage } }`
`window.maxDays` is the plan cap (`-1` unlimited); `totals.prior` is the
period before the window; `heatmap.engagements[weekday][hour]` uses `tz`
(minutes east of UTC, default 0, Monday is 0). `insights[].sampleSize` says
how many posts each finding rests on. The account as a whole is counted:
`source` is `markaestro` or `native` to narrow to one half, and
`coverage.bySource` reports both counts.

**`list_post_analytics`** `{ days?, since?, until?, channel?, source?, sort?, limit? }` → `{ window, sort, posts: [{ id, content, channels, publishedAt, externalUrl, contentType, source, canTakeDown, views, reach, likes, comments, shares, saves, clicks, engagements, erByReach, erByViews }], count, truncated }`
`source` on a row is `markaestro` (went out through Markaestro) or `native`
(published directly on the platform, discovered from the connected account).
`sort` is `published_at` (default), `views`, `reach`, `engagements`, or
`engagement_rate`, descending, missing values last. `limit` defaults to 100
(max 500); `truncated` is true when more matched. `content` is the first 160
characters; use `get_post` for the whole caption.

**`get_post_analytics_history`** `{ postId }` → `{ post: { id, content, publishedAt, channels, externalUrl, source, metricsStatus, nextPollAt, latest }, stages: [{ stageKey, capturedAt, hoursAfterPublish, views, reach, engagements, likes, comments, shares, saves, viewsDelta, engagementsDelta, byChannel }] }`
Stages are oldest first (`1h`, `6h`, `24h`, ... `90d`, then `latest`); a
native post starts with `discovered`. Any id from the leaderboard or the
list works, whichever source it came from.
`NOT_FOUND` for a post outside this brand, a draft, or a sandbox post.

## Publish runs

**`get_job_run`** `{ runId }` → `{ run: { status: queued | running | succeeded | failed, message, details } }`

**`list_job_runs`** `{ status?, resourceId? (a post id), limit?, cursor? }` → `{ runs: [...], nextCursor }`

## Webhooks (needs the `webhooks.manage` scope)

**`list_webhook_endpoints`** `{}` → `{ webhookEndpoints: [...] }`

**`create_webhook_endpoint`** `{ url, events: ["post.published", ...] }` →
`{ webhookEndpoint: { id, secret, ... } }`. The secret is shown once.
