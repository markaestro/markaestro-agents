/**
 * Tool definitions, kept free of MCP transport concerns so they can be unit
 * tested by calling `handler` directly. `registerTools` in server.ts wires
 * them into the MCP server.
 */
import { z } from "zod";
import { MarkaestroApiError, type MarkaestroClient } from "./client";

export const CHANNELS = ["facebook", "instagram", "tiktok", "threads", "pinterest", "linkedin", "x"] as const;
export const DELIVERY_MODES = ["direct_publish", "platform_inbox", "manual_reminder"] as const;

const channel = z.enum(CHANNELS);
const deliveryMode = z.enum(DELIVERY_MODES).describe(
  "direct_publish: official platform API. manual_reminder: a timed reminder for a person to post natively (default on facebook, instagram, tiktok). platform_inbox: TikTok inbox handoff. Required when scheduling facebook, instagram, or tiktok.",
);
const isoDate = z.string().describe("ISO 8601 UTC timestamp, for example 2026-09-10T14:00:00Z");
const brand = z.string().optional().describe(
  "Brand id from list_products. Required when this connection covers all brands in the workspace; a single-brand connection always uses its own brand and may omit it.",
);

const target = z.object({
  channel,
  destinationId: z.string().optional().describe("Needed only when the brand has more than one destination for this channel; see list_destinations."),
  deliveryMode: deliveryMode.optional(),
  settings: z.record(z.string(), z.unknown()).optional().describe("Platform settings with __type equal to the channel (instagram: postType, collaborators, altText; tiktok: postMode, privacyLevel, ...)."),
});

export type ToolDefinition = {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodRawShape;
  /** Reads only. Every other tool changes data, so it is annotated destructive and Claude confirms each call. */
  readOnly: boolean;
  /**
   * Reaches past Markaestro's own records: posts or schedules to a social
   * platform, fetches a caller-supplied URL, or sends data to one. Reads of
   * the workspace stay closed-world.
   */
  openWorld?: boolean;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
};

/** Everything the API needs to know about channels, in one place an agent can read before posting. */
export const CHANNEL_RULES = `Markaestro channel rules (one post targets one or more channels; publishing never fans out across channels):
- facebook: text, images (max 10) or 1 video. Scheduling requires deliveryMode.
- instagram: at least 1 media item, max 10; a single video publishes as a Reel; stories take one image or video. Scheduling requires deliveryMode.
- tiktok: at least 1 media item: 1 video or up to 35 images. Default publish path is the creator's TikTok inbox; direct_post needs settings.privacyLevel. Scheduling requires deliveryMode.
- threads: text, image, or video; carousels up to 20 items.
- pinterest: media required; up to 5 images or exactly 1 video.
- linkedin: text required; images or 1 video, up to 20 items.
- x: text, up to 4 images, or 1 video; images and video cannot be mixed.
Caption limits: facebook 63206, linkedin 3000, instagram 2200, tiktok 2200, pinterest 500, threads 500, x 280.
Media: image/png, image/jpeg, image/webp, image/gif up to 10 MB; video/mp4, video/quicktime, video/webm up to 250 MB.
Posting model: create_post stores a draft unless scheduledAt is set (then the worker publishes at that time). publish_post queues an immediate publish and returns a job run to poll with get_job_run.
A connection covers either one brand (product) or every brand in the workspace, chosen when it was created. On an all-brands connection, pass productId to create_post, create_posts, list_posts, and create_evergreen_queue.`;

export function createTools(client: MarkaestroClient): ToolDefinition[] {
  const get = <T>(path: string, query?: Record<string, string | number | undefined>) => client.request<T>("GET", path, undefined, query);

  return [
    {
      name: "list_products",
      title: "List brands",
      description: "List the brands (products) this connection can act on, with their connected channels: one brand for a single-brand connection, every brand in the workspace for an all-brands one. Call this first to learn each productId and which channels can be posted to.",
      inputSchema: {},
      readOnly: true,
      handler: () => get("/api/public/v1/products"),
    },
    {
      name: "list_destinations",
      title: "List destinations",
      description: "List the publishable destinations (Facebook Page, Instagram account, TikTok account, ...) of a brand, with their ids and delivery modes. Use a destinationId on create_post only when a channel has more than one destination.",
      inputSchema: {
        productId: z.string().describe("Brand id from list_products"),
      },
      readOnly: true,
      handler: ({ productId }) => get(`/api/public/v1/products/${encodeURIComponent(String(productId))}/destinations`),
    },
    {
      name: "list_posts",
      title: "List posts",
      description: "List posts, newest first. Filter by status: draft, scheduled, publishing, published, platform_action_required, failed, partial_failed. On an all-brands connection, pass productId to list one brand. Use cursor from a previous page to continue.",
      inputSchema: {
        productId: brand,
        status: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional().describe("Default 25, max 100"),
        cursor: z.string().optional(),
      },
      readOnly: true,
      handler: ({ productId, status, limit, cursor }) => get("/api/public/v1/posts", {
        productId: productId as string | undefined,
        status: status as string | undefined,
        limit: limit as number | undefined,
        cursor: cursor as string | undefined,
      }),
    },
    {
      name: "get_post",
      title: "Get a post",
      description: "Fetch one post with its targets, status, media, schedule, publish results, and live URL when published.",
      inputSchema: { postId: z.string() },
      readOnly: true,
      handler: ({ postId }) => get(`/api/public/v1/posts/${encodeURIComponent(String(postId))}`),
    },
    {
      name: "create_post",
      title: "Create a post",
      description: `Create a post for this brand. Without scheduledAt the post is saved as a DRAFT and nothing is published; with scheduledAt it is scheduled and the worker publishes it at that time. Pass either a single channel or a targets array (one entry per channel). Upload media first with upload_media and pass the asset ids. Read channel rules with get_channel_rules before posting.`,
      inputSchema: {
        productId: brand,
        caption: z.string().max(63206).default("").describe("Post text. Required on linkedin."),
        channel: channel.optional().describe("Single channel. Mutually exclusive with targets."),
        targets: z.array(target).min(1).max(7).optional().describe("Several channels at once, each with its own destination and delivery mode."),
        mediaAssetIds: z.array(z.string()).max(35).optional().describe("Asset ids from upload_media or list_media, in display order."),
        scheduledAt: isoDate.optional().describe("Omit to save a draft."),
        destinationId: z.string().optional().describe("For the single-channel form, when the brand has several destinations on that channel."),
        deliveryMode: deliveryMode.optional(),
        settings: z.record(z.string(), z.unknown()).optional().describe("Platform settings for the single-channel form; __type must equal channel."),
      },
      readOnly: false,
      openWorld: true,
      handler: async (args) => {
        const body: Record<string, unknown> = {};
        for (const key of ["productId", "caption", "channel", "targets", "mediaAssetIds", "scheduledAt", "destinationId", "deliveryMode", "settings"]) {
          if (args[key] !== undefined) body[key] = args[key];
        }
        const result = await client.request<{ post: Record<string, unknown> }>("POST", "/api/public/v1/posts", body);
        const post = result.post;
        return {
          post,
          note: post.status === "scheduled"
            ? `Scheduled. It publishes at ${String(post.scheduledAt)} (UTC). Cancel with delete_post before then if needed.`
            : "Saved as a draft. Nothing is published until you call publish_post or a person publishes it from Markaestro.",
        };
      },
    },
    {
      name: "publish_post",
      title: "Publish a post now",
      description: "Queue an immediate publish of a draft post. Returns a job run; poll get_job_run until status is succeeded or failed. For manual_reminder targets this queues a reminder for a person instead of calling the platform. Confirm with the user before publishing anything public.",
      inputSchema: { postId: z.string() },
      readOnly: false,
      openWorld: true,
      handler: ({ postId }) => client.request("POST", `/api/public/v1/posts/${encodeURIComponent(String(postId))}/publish`),
    },
    {
      name: "delete_post",
      title: "Delete a post",
      description: "Delete a draft, cancel a scheduled post, or take a post down. Without platform, a published Markaestro post is only removed from Markaestro and the live copy stays up; with platform: true it is first taken down from every channel it went to and the record goes only once every live copy is gone. A post published directly on the platform (an analytics id with source native) is always taken down from the platform, since that is all there is to delete. Instagram and TikTok offer no delete to apps: a takedown skips those channels and lists them under platform.skipped, and a native post there is refused; check canTakeDown on the analytics row before offering. Taking a live post down needs the posts.publish scope. Posts mid-publish cannot be deleted until the run settles.",
      inputSchema: {
        postId: z.string().describe("A Markaestro post id, or the id of a native post from list_post_analytics"),
        platform: z.boolean().optional().describe("Also take a published Markaestro post down from its platforms; implied for a native post"),
      },
      readOnly: false,
      openWorld: true,
      handler: ({ postId, platform }) => client.request(
        "DELETE",
        `/api/public/v1/posts/${encodeURIComponent(String(postId))}`,
        undefined,
        platform ? { platform: "true" } : undefined,
      ),
    },
    {
      name: "bulk_posts",
      title: "Reschedule, delete, or restatus posts",
      description: "Apply one action to up to 25 posts: reschedule (needs scheduledAt), delete, or status (draft or scheduled). Per-post failures are reported individually.",
      inputSchema: {
        ids: z.array(z.string()).min(1).max(25),
        action: z.enum(["reschedule", "delete", "status"]),
        scheduledAt: isoDate.optional().describe("Required for reschedule"),
        status: z.enum(["draft", "scheduled"]).optional().describe("Required for the status action"),
      },
      readOnly: false,
      openWorld: true,
      handler: ({ ids, action, scheduledAt, status }) => {
        const body: Record<string, unknown> = { ids, action };
        if (action === "reschedule") body.scheduledAt = scheduledAt;
        if (action === "status") body.status = status;
        return client.request("POST", "/api/public/v1/posts/bulk", body);
      },
    },
    {
      name: "create_posts",
      title: "Create several posts",
      description: "Create up to 25 posts in one call, for example a week of scheduled content. Each item takes the same fields as create_post. Failures are per item: the response lists ok/error for each, and the successful ones are created even when others fail.",
      inputSchema: {
        posts: z.array(z.object({
          productId: brand,
          caption: z.string().max(63206).default(""),
          channel: channel.optional(),
          targets: z.array(target).min(1).max(7).optional(),
          mediaAssetIds: z.array(z.string()).max(35).optional(),
          scheduledAt: isoDate.optional(),
          destinationId: z.string().optional(),
          deliveryMode: deliveryMode.optional(),
          settings: z.record(z.string(), z.unknown()).optional(),
        })).min(1).max(25),
      },
      readOnly: false,
      openWorld: true,
      handler: async ({ posts }) => {
        const items = (posts as Array<Record<string, unknown>>).map((item) => {
          const body: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(item)) if (value !== undefined) body[key] = value;
          return body;
        });
        return client.request("POST", "/api/public/v1/posts", { posts: items });
      },
    },
    {
      name: "preview_evergreen_queue",
      title: "Preview Evergreen eligibility",
      description: "Check whether a published post has mature measured performance and get a recommended Evergreen cadence. This does not create or schedule anything.",
      inputSchema: { sourcePostId: z.string() },
      readOnly: true,
      handler: ({ sourcePostId }) => client.request("POST", "/api/public/v1/evergreen-queues/preview", { sourcePostId }),
    },
    {
      name: "list_evergreen_queues",
      title: "List Evergreen queues",
      description: "List this brand's Intelligent Evergreen queues and their activation evidence, cadence, next run, and status.",
      inputSchema: {},
      readOnly: true,
      handler: () => get("/api/public/v1/evergreen-queues"),
    },
    {
      name: "get_evergreen_queue",
      title: "Get an Evergreen queue",
      description: "Get one Intelligent Evergreen queue including its caption variants.",
      inputSchema: { queueId: z.string() },
      readOnly: true,
      handler: ({ queueId }) => get(`/api/public/v1/evergreen-queues/${encodeURIComponent(String(queueId))}`),
    },
    {
      name: "create_evergreen_queue",
      title: "Create an Evergreen queue",
      description: "Create a draft Evergreen queue from an eligible published post. Creation does not activate it; call activate_evergreen_queue only after the user confirms the cadence and review policy.",
      inputSchema: {
        sourcePostId: z.string(),
        productId: brand,
        name: z.string().min(1).max(120),
        channels: z.array(channel).min(1).max(7).optional(),
        intervalDays: z.number().int().min(7).max(365).default(30),
        timeZone: z.string().default("UTC"),
        localHour: z.number().int().min(0).max(23).default(10),
        localMinute: z.number().int().min(0).max(59).default(0),
        scheduleMode: z.enum(["fixed", "learned"]).default("learned"),
        reviewPolicy: z.enum(["approve_future_runs", "review_each_run"]).default("review_each_run"),
        expiresAt: isoDate.optional(),
        variants: z.array(z.object({ caption: z.string().min(1).max(63206), enabled: z.boolean().default(true) })).min(1).max(20),
      },
      readOnly: false,
      handler: (args) => client.request("POST", "/api/public/v1/evergreen-queues", args),
    },
    {
      name: "update_evergreen_queue",
      title: "Update an Evergreen queue",
      description: "Update a queue's cadence, review policy, expiry, name, or full caption-variant set. Pass the current version from get_evergreen_queue; a stale version is rejected so concurrent edits are not overwritten.",
      inputSchema: {
        queueId: z.string(),
        version: z.number().int().positive(),
        name: z.string().min(1).max(120).optional(),
        intervalDays: z.number().int().min(7).max(365).optional(),
        timeZone: z.string().optional(),
        localHour: z.number().int().min(0).max(23).optional(),
        localMinute: z.number().int().min(0).max(59).optional(),
        scheduleMode: z.enum(["fixed", "learned"]).optional(),
        reviewPolicy: z.enum(["approve_future_runs", "review_each_run"]).optional(),
        expiresAt: isoDate.nullable().optional(),
        variants: z.array(z.object({ caption: z.string().min(1).max(63206), enabled: z.boolean().default(true) })).min(1).max(20).optional(),
      },
      readOnly: false,
      openWorld: true,
      handler: ({ queueId, ...body }) => client.request("PATCH", `/api/public/v1/evergreen-queues/${encodeURIComponent(String(queueId))}`, body),
    },
    {
      name: "activate_evergreen_queue",
      title: "Activate an Evergreen queue",
      description: "Activate a draft or paused queue. This schedules future public posts, so confirm with the user first.",
      inputSchema: { queueId: z.string() },
      readOnly: false,
      openWorld: true,
      handler: ({ queueId }) => client.request("POST", `/api/public/v1/evergreen-queues/${encodeURIComponent(String(queueId))}/activate`),
    },
    {
      name: "pause_evergreen_queue",
      title: "Pause an Evergreen queue",
      description: "Pause a queue and unschedule any pending occurrence generated by it.",
      inputSchema: { queueId: z.string() },
      readOnly: false,
      handler: ({ queueId }) => client.request("POST", `/api/public/v1/evergreen-queues/${encodeURIComponent(String(queueId))}/pause`),
    },
    {
      name: "resume_evergreen_queue",
      title: "Resume an Evergreen queue",
      description: "Resume a paused queue and compute its next occurrence from the current time.",
      inputSchema: { queueId: z.string() },
      readOnly: false,
      openWorld: true,
      handler: ({ queueId }) => client.request("POST", `/api/public/v1/evergreen-queues/${encodeURIComponent(String(queueId))}/resume`),
    },
    {
      name: "archive_evergreen_queue",
      title: "Archive an Evergreen queue",
      description: "Archive a queue permanently and unschedule its pending occurrence.",
      inputSchema: { queueId: z.string() },
      readOnly: false,
      handler: ({ queueId }) => client.request("DELETE", `/api/public/v1/evergreen-queues/${encodeURIComponent(String(queueId))}`),
    },
    {
      name: "list_evergreen_runs",
      title: "List Evergreen runs",
      description: "List the generated occurrences and evaluation outcomes for a queue.",
      inputSchema: { queueId: z.string() },
      readOnly: true,
      handler: ({ queueId }) => get(`/api/public/v1/evergreen-queues/${encodeURIComponent(String(queueId))}/runs`),
    },
    {
      name: "get_evergreen_analytics",
      title: "Get Evergreen analytics",
      description: "Get source metrics, queue-lifetime metrics, tracked clicks, attributed conversions, and recent run outcomes. Unavailable provider metrics are null, not zero.",
      inputSchema: { queueId: z.string() },
      readOnly: true,
      handler: ({ queueId }) => get(`/api/public/v1/evergreen-queues/${encodeURIComponent(String(queueId))}/analytics`),
    },
    {
      name: "get_analytics",
      title: "Get brand analytics",
      description: "Performance over a window for the connection's brand, or on an all-brands connection for the workspace or the one brand named by productId: totals with the prior period for deltas, per-channel rollups, daily series, engagement breakdown, follower trend, top posts, posting-time heatmap, content-type averages, computed insights, and coverage. Covers the whole account: posts published through Markaestro and posts published directly on the platform (discovered from the connected account); coverage.bySource says how many of each. Read this before recommending what, when, or where to post. The window is clamped to the plan's history (the response reports maxDays). Unavailable provider metrics are null, not zero.",
      inputSchema: {
        days: z.number().int().min(1).max(365).optional().describe("Preset window ending today (UTC); default 28"),
        since: z.string().optional().describe("Explicit range start, YYYY-MM-DD (UTC); needs until"),
        until: z.string().optional().describe("Explicit range end, YYYY-MM-DD (UTC), inclusive"),
        channel: channel.optional().describe("Restrict every number to one channel"),
        source: z.enum(["markaestro", "native"]).optional().describe("Only posts published through Markaestro, or only posts published directly on the platform; omit for the whole account"),
        tz: z.number().int().min(-840).max(840).optional().describe("Viewer timezone offset in minutes east of UTC; shapes the heatmap only"),
        productId: z.string().optional().describe("One brand, on an all-brands connection; omit for the whole workspace. A single-brand connection always reports its own brand."),
      },
      readOnly: true,
      handler: ({ days, since, until, channel: ch, source, tz, productId }) => get("/api/public/v1/analytics", {
        productId: productId as string | undefined,
        days: days as number | undefined,
        since: since as string | undefined,
        until: until as string | undefined,
        channel: ch as string | undefined,
        source: source as string | undefined,
        tz: tz as number | undefined,
      }),
    },
    {
      name: "list_post_analytics",
      title: "List post analytics",
      description: "Every post in the window (the connection's brand, or on an all-brands connection the workspace or the brand named by productId) with its latest metrics (views, reach, likes, comments, shares, saves, clicks, engagements, engagement rate), one row per post, sorted. Includes posts published directly on the platform; each row's source says markaestro or native, and canTakeDown says whether delete_post can remove the live copy (false on Instagram and TikTok). Use sort=engagements or sort=views to find what worked; sort=published_at (default) for a chronological read. Pair with get_post for the full caption and media of a Markaestro post (native posts have externalUrl instead).",
      inputSchema: {
        days: z.number().int().min(1).max(365).optional().describe("Preset window ending today (UTC); default 28"),
        since: z.string().optional().describe("Explicit range start, YYYY-MM-DD (UTC); needs until"),
        until: z.string().optional().describe("Explicit range end, YYYY-MM-DD (UTC), inclusive"),
        channel: channel.optional(),
        source: z.enum(["markaestro", "native"]).optional().describe("Only posts published through Markaestro, or only posts published directly on the platform; omit for the whole account"),
        sort: z.enum(["published_at", "views", "reach", "engagements", "engagement_rate"]).optional().describe("Descending; default published_at"),
        limit: z.number().int().min(1).max(500).optional().describe("Default 100"),
        productId: z.string().optional().describe("One brand, on an all-brands connection; omit for the whole workspace. A single-brand connection always reports its own brand."),
      },
      readOnly: true,
      handler: ({ days, since, until, channel: ch, source, sort, limit, productId }) => get("/api/public/v1/analytics/posts", {
        productId: productId as string | undefined,
        days: days as number | undefined,
        since: since as string | undefined,
        until: until as string | undefined,
        channel: ch as string | undefined,
        source: source as string | undefined,
        sort: sort as string | undefined,
        limit: limit as number | undefined,
      }),
    },
    {
      name: "get_post_analytics_history",
      title: "Get post analytics history",
      description: "How one post earned its numbers over time: the metric snapshots taken 1h, 6h, 24h, 72h, 7d, 14d, 30d, 60d, and 90d after publish (a post published directly on the platform starts with a discovered snapshot), with the growth between stages, plus the current totals and whether polling is still active. Takes any id from get_analytics or list_post_analytics. Answers NOT_FOUND for posts outside this brand.",
      inputSchema: { postId: z.string() },
      readOnly: true,
      handler: ({ postId }) => get(`/api/public/v1/analytics/posts/${encodeURIComponent(String(postId))}/history`),
    },
    {
      name: "upload_media",
      title: "Upload media",
      description: "Upload an image or video from a local file path, an http(s) URL, or a data: URL. Returns the media asset; pass its id in create_post mediaAssetIds. Counts against the workspace's monthly upload quota.",
      inputSchema: {
        source: z.string().describe("Local file path, http(s) URL, or data: URL"),
        fileName: z.string().optional(),
        contentType: z.string().optional().describe("Inferred from the file extension or URL when omitted"),
      },
      readOnly: false,
      openWorld: true,
      handler: ({ source, fileName, contentType }) => client.uploadMedia({
        source: String(source),
        fileName: fileName as string | undefined,
        contentType: contentType as string | undefined,
      }).then((asset) => ({ asset })),
    },
    {
      name: "list_media",
      title: "List media",
      description: "List uploaded media assets with their ids, type, dimensions, and how many posts reference them.",
      inputSchema: {
        type: z.enum(["image", "video"]).optional(),
        limit: z.number().int().min(1).max(100).optional(),
        cursor: z.string().optional(),
      },
      readOnly: true,
      handler: ({ type, limit, cursor }) => get("/api/public/v1/media", {
        type: type as string | undefined,
        limit: limit as number | undefined,
        cursor: cursor as string | undefined,
      }),
    },
    {
      name: "get_media",
      title: "Get a media asset",
      description: "Fetch one media asset: type, dimensions, processing state, thumbnail, and how many posts reference it.",
      inputSchema: { assetId: z.string() },
      readOnly: true,
      handler: ({ assetId }) => get(`/api/public/v1/media/${encodeURIComponent(String(assetId))}`),
    },
    {
      name: "get_job_run",
      title: "Get a publish run",
      description: "Check the status of a publish run returned by publish_post: queued, running, succeeded, or failed, with the message and details.",
      inputSchema: { runId: z.string() },
      readOnly: true,
      handler: ({ runId }) => get(`/api/public/v1/job-runs/${encodeURIComponent(String(runId))}`),
    },
    {
      name: "list_job_runs",
      title: "List publish runs",
      description: "List recent publish runs, optionally filtered by status or by the post id (resourceId).",
      inputSchema: {
        status: z.enum(["queued", "running", "succeeded", "failed"]).optional(),
        resourceId: z.string().optional().describe("A post id"),
        limit: z.number().int().min(1).max(100).optional(),
        cursor: z.string().optional(),
      },
      readOnly: true,
      handler: ({ status, resourceId, limit, cursor }) => get("/api/public/v1/job-runs", {
        status: status as string | undefined,
        resourceId: resourceId as string | undefined,
        limit: limit as number | undefined,
        cursor: cursor as string | undefined,
      }),
    },
    {
      name: "list_webhook_endpoints",
      title: "List webhook endpoints",
      description: "List the webhook endpoints registered for this workspace (needs the webhooks.manage scope).",
      inputSchema: {},
      readOnly: true,
      handler: () => get("/api/public/v1/webhook-endpoints"),
    },
    {
      name: "create_webhook_endpoint",
      title: "Register a webhook endpoint",
      description: "Register an HTTPS endpoint for post.publish.queued, post.published, post.action_required, or post.failed events. The signing secret is returned once; store it.",
      inputSchema: {
        url: z.string().url(),
        events: z.array(z.enum([
          "post.publish.queued",
          "post.published",
          "post.action_required",
          "post.failed",
          "evergreen.queue.activated",
          "evergreen.queue.paused",
          "evergreen.queue.needs_review",
          "evergreen.run.scheduled",
          "evergreen.run.skipped",
          "evergreen.run.underperformed",
        ])).min(1).max(10),
      },
      readOnly: false,
      openWorld: true,
      handler: ({ url, events }) => client.request("POST", "/api/public/v1/webhook-endpoints", { url, events }),
    },
    {
      name: "get_channel_rules",
      title: "Channel rules",
      description: "The per-channel media, caption, and delivery-mode rules the API enforces, plus the draft-then-publish model. Read before creating posts.",
      inputSchema: {},
      readOnly: true,
      handler: async () => ({ rules: CHANNEL_RULES, keyMode: client.isTestKey ? "test" : "live", baseUrl: client.baseUrl }),
    },
  ];
}

/** Turn an API failure into text an agent can act on. */
export function describeError(error: unknown): string {
  if (error instanceof MarkaestroApiError) {
    const lines = [`${error.code} (HTTP ${error.status}): ${error.message}`];
    if (error.issues?.length) {
      for (const issue of error.issues) lines.push(`- ${issue.channel ? `${issue.channel}: ` : ""}${issue.code ? `${issue.code} ` : ""}${issue.message}`);
    }
    if (error.retryAfterSeconds) lines.push(`Retry after ${error.retryAfterSeconds} seconds.`);
    if (error.status === 401) lines.push("Check MARKAESTRO_API_KEY: the key is missing, revoked, expired, or in the wrong mode.");
    if (error.status === 403) lines.push("The key lacks the scope for this call. Create a key with the needed scopes under Settings > API Access.");
    if (error.status === 402) lines.push("The workspace hit a plan limit or has no active subscription.");
    if (error.requestId) lines.push(`requestId ${error.requestId}`);
    return lines.join("\n");
  }
  return error instanceof Error ? error.message : String(error);
}
