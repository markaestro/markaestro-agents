# Delivery modes, statuses, and platform settings

## Delivery modes

| Mode | Meaning | Default on |
| --- | --- | --- |
| `direct_publish` | Markaestro calls the platform API at publish time | threads, pinterest, linkedin, x |
| `manual_reminder` | No platform call. The post becomes `platform_action_required` and a person posts it natively from the reminder queue | facebook, instagram, tiktok |
| `platform_inbox` | TikTok only: the post is handed to the creator's TikTok inbox to finish inside the app | n/a |

Scheduling a facebook, instagram, or tiktok post requires an explicit mode,
otherwise `VALIDATION_SCHEDULED_DELIVERY_MODE_REQUIRED`.

## Post statuses

| Status | Meaning |
| --- | --- |
| `draft` | Saved, not scheduled, nothing sent |
| `scheduled` | The worker publishes it at `scheduledAt` |
| `publishing` | A run is in flight; the post cannot be edited or deleted |
| `published` | Live; `externalUrl` points at it |
| `platform_action_required` | A person must finish it; read `nextAction` |
| `failed` | Every target failed; read `publishResults` |
| `partial_failed` | Some targets published, some failed |

## Channel rules

| Channel | Media | Caption limit | Notes |
| --- | --- | --- | --- |
| facebook | optional, up to 10 images or 1 video | 63,206 | |
| instagram | required, up to 10 items | 2,200 | single video becomes a Reel; stories take one item |
| tiktok | required, 1 video or up to 35 images | 2,200 | inbox handoff by default; direct post needs `privacyLevel` |
| threads | optional, up to 20 items | 500 | |
| pinterest | required, up to 5 images or exactly 1 video | 500 | a video pin carries no other media |
| linkedin | optional, up to 20 items; a video must be alone | 3,000 | text required |
| x | optional, up to 4 images or exactly 1 video | 280 | images and video cannot be mixed |

Accepted uploads: `image/png`, `image/jpeg`, `image/webp`, `image/gif` up to
10 MB; `video/mp4`, `video/quicktime`, `video/webm` up to 250 MB.

## Platform settings

`settings.__type` must equal the channel. One target per post may carry
settings.

**instagram**
```json
{ "__type": "instagram", "postType": "feed" | "reel" | "story",
  "collaborators": ["partnerbrand"], "altText": ["Front view", "Detail"] }
```

**tiktok**
```json
{ "__type": "tiktok", "postMode": "inbox" | "direct_post",
  "privacyLevel": "PUBLIC_TO_EVERYONE" | "MUTUAL_FOLLOW_FRIENDS" | "FOLLOWER_OF_CREATOR" | "SELF_ONLY",
  "disableComment": false, "disableDuet": false, "disableStitch": false,
  "commercialContentDisclosure": false, "brandOrganicToggle": false, "brandContentToggle": false,
  "photoCoverIndex": 0 }
```
`direct_post` requires `privacyLevel`. `brandContentToggle` cannot be combined
with `SELF_ONLY`; `commercialContentDisclosure` requires one of the brand
toggles.

**x**
```json
{ "__type": "x", "replySettings": "following" | "mentionedUsers" | "subscribers" | "verified" }
```

## Webhook events

`post.publish.queued`, `post.published`, `post.action_required`,
`post.failed`, `evergreen.queue.activated`, `evergreen.queue.paused`,
`evergreen.queue.needs_review`, `evergreen.run.scheduled`,
`evergreen.run.skipped`, and `evergreen.run.underperformed`. Deliveries are signed with HMAC-SHA256 over
`<timestamp>.<raw body>` in `X-Markaestro-Signature`.
