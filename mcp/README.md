# @markaestro/mcp

A [Model Context Protocol](https://modelcontextprotocol.io) server that lets AI
agents (Claude Code, Claude, Cursor, ChatGPT, Grok, Grok Bot, OpenClaw, Hermes,
and any other MCP client) schedule, publish, and review Markaestro posts
through the public API. Exact connection steps per client are on
https://markaestro.com/developers/agents (`?client=cursor`, `chatgpt`, `grok`,
`grok-bot`, `openclaw`, `hermes`, or `headless` opens that tab).

One API key, one brand: every Markaestro key is bound to a single brand, so the
server operates on that brand only. Run one server per brand if an agent needs
several.

## Tools

| Tool | What it does |
| --- | --- |
| `list_products` | The brand this key is bound to and its connected channels |
| `list_destinations` | Publishable destinations of the brand (pages, accounts) with ids |
| `list_posts`, `get_post` | Read posts by status, page through with `cursor` |
| `create_post` | Save a draft, or schedule when `scheduledAt` is set |
| `publish_post` | Queue an immediate publish; returns a job run |
| `delete_post` | Delete a draft, cancel a scheduled post, or take a published or native post down from its platforms (`platform: true`) |
| `bulk_posts` | Reschedule, delete, or restatus up to 25 posts |
| `create_posts` | Up to 25 posts in one call, per-item results |
| `upload_media` | Upload from a file path, URL, or data URL; returns the asset id |
| `list_media`, `get_media` | Uploaded assets, processing state, reference counts |
| `get_analytics` | Brand performance over a window: totals, channels, daily series, top posts, heatmap, insights. Covers posts published through Markaestro and posts published directly on the platform |
| `list_post_analytics` | Every post in the window with its latest metrics and source, sortable by views, reach, engagements, or engagement rate |
| `get_post_analytics_history` | The 1h to 90d metric snapshots of one post, with growth between stages |
| `get_job_run`, `list_job_runs` | Follow a publish to succeeded or failed |
| `list_webhook_endpoints`, `create_webhook_endpoint` | Webhook registration |
| `get_channel_rules` | Per-channel media, caption, and delivery-mode rules |

Also served: the `markaestro://channel-rules` resource and a `schedule_post`
prompt that walks an agent through a safe scheduling flow.

Posting is draft-first. `create_post` without `scheduledAt` never publishes;
`publish_post` is the only tool that publishes now, and its description tells
the agent to confirm with the user first.

## Two ways to connect

**Hosted (nothing to install, nothing to paste).** Markaestro serves the
same tools over Streamable HTTP at `https://markaestro.com/api/public/v1/mcp`.
Add it with no credentials and the first tool call opens the browser: sign
in, pick the workspace and brand, click Allow. The client receives an API key
bound to that brand and refreshes it on its own.

```bash
claude mcp add --transport http markaestro https://markaestro.com/api/public/v1/mcp
```

This is standard OAuth 2.1 (PKCE, dynamic client registration, discovery at
`/.well-known/oauth-protected-resource` and
`/.well-known/oauth-authorization-server`), so claude.ai, Cursor, and other
MCP clients connect the same way. Connected agents are listed and revoked in
Settings, API.

For headless or CI use, pass a workspace API key as a bearer header instead:

```bash
claude mcp add --transport http markaestro https://markaestro.com/api/public/v1/mcp \
  --header "Authorization: Bearer mk_live_..."
```

```json
{
  "mcpServers": {
    "markaestro": {
      "type": "http",
      "url": "https://markaestro.com/api/public/v1/mcp",
      "headers": { "Authorization": "Bearer mk_live_..." }
    }
  }
}
```

Send `x-markaestro-read-only: 1` as an extra header to get only the reading
tools.

**Local package.** Run the server on your machine over stdio, which also
lets `upload_media` read local files:

## Setup

1. Create an API key in Markaestro under Settings > API Access. Pick the brand,
   the scopes the agent needs (`products.read`, `posts.read`, `posts.write`,
   `media.write`, and `posts.publish` if it may publish), and prefer a **test**
   key while you evaluate.
2. Give the key to the server through `MARKAESTRO_API_KEY`.

### Claude Code

```bash
claude mcp add markaestro -e MARKAESTRO_API_KEY=mk_live_... -- npx -y @markaestro/mcp
```

### Claude Desktop, Cursor, and other JSON configs

```json
{
  "mcpServers": {
    "markaestro": {
      "command": "npx",
      "args": ["-y", "@markaestro/mcp"],
      "env": { "MARKAESTRO_API_KEY": "mk_live_..." }
    }
  }
}
```

### Environment

| Variable | Required | Default |
| --- | --- | --- |
| `MARKAESTRO_API_KEY` | yes | n/a |
| `MARKAESTRO_BASE_URL` | no | `https://markaestro.com` |
| `MARKAESTRO_READ_ONLY` | no | unset; `1` registers only reading tools |

## What the server does for you

- Sends an `Idempotency-Key` on every mutation, minted once per call, so a
  retried request replays instead of double-posting.
- Retries `429` and transient `5xx` responses using the server's `Retry-After`.
- Runs the three-step direct media upload (session, `PUT` to storage,
  finalize) and never sends the API key to the storage URL.
- Returns API failures as tool errors with the stable error `code`, any
  per-channel `issues`, and a hint about what to change.

## Claude Code plugin

The skill and the hosted server ship together as a plugin:

```bash
claude plugin marketplace add markaestro/markaestro-agents
claude plugin install markaestro@markaestro
```

## Deploying

| Surface | How it ships |
| --- | --- |
| Hosted MCP (`/api/public/v1/mcp`) | Part of the Next.js app; deploys on push to `main` like every route |
| `@markaestro/mcp` on npm | `cd mcp && npm version <x.y.z> && npm publish` (public scoped package; `prepublishOnly` builds). Bump `src/version.ts` with it |
| Plugin and skill | Mirrored to the public repo `markaestro/markaestro-agents` with `node scripts/sync-agents-repo.mjs <clone>`, then pushed there; `claude plugin marketplace add markaestro/markaestro-agents` reads it. The skill alone can be copied to `~/.claude/skills/markaestro` |
| MCP Registry (`com.markaestro/mcp`) | After the npm publish of the same version: `mcp-publisher login http --domain markaestro.com --private-key <hex>` then `mcp-publisher publish` from `mcp/`. The public key is served at `/.well-known/mcp-registry-auth` |

## Development

```bash
cd mcp
npm install
npm run build
MARKAESTRO_API_KEY=mk_test_... MARKAESTRO_BASE_URL=http://localhost:3000 npm run smoke            # local stdio
MARKAESTRO_API_KEY=mk_test_... MARKAESTRO_BASE_URL=http://localhost:3000 npm run smoke -- --remote # hosted endpoint
```

Unit tests live in `src/__tests__` and run with the repository's `npm test`.
The smoke script starts the built server over stdio, lists tools, reads the
brand, creates a draft, reads it back, and deletes it. Nothing is published.
