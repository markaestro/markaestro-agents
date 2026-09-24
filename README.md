# Markaestro for AI agents

Official agent tooling for [Markaestro](https://markaestro.com), the social
publishing workspace. Agents schedule, publish, and review posts on Facebook,
Instagram, TikTok, Threads, Pinterest, LinkedIn, and X, read brand and
per-post analytics, and manage Intelligent Evergreen queues.

| Folder | What it is |
| --- | --- |
| [`plugin/`](plugin) | Claude Code plugin: the skill plus the hosted MCP server |
| [`skills/markaestro/`](skills/markaestro) | The `markaestro` Agent Skill, usable by any client that supports skills |
| [`mcp/`](mcp) | [`@markaestro/mcp`](https://www.npmjs.com/package/@markaestro/mcp), the MCP server as a local stdio package |

## Connect

The hosted MCP server needs nothing installed and no key pasted. Add
`https://markaestro.com/api/public/v1/mcp` to your client; the first tool
call opens the browser to sign in, pick a workspace and brand, and click
Allow (OAuth 2.1 with PKCE and dynamic client registration).

**Claude Code**

```bash
claude plugin marketplace add markaestro/markaestro-agents
claude plugin install markaestro@markaestro
```

**Claude, Cursor, ChatGPT, Grok, OpenClaw, Hermes, and other clients:** step
by step instructions for each are at
[markaestro.com/developers/agents](https://markaestro.com/developers/agents).

**Skill only**

```bash
npx skills add markaestro/markaestro-agents
```

**Local package** (reads media from your own disk; needs a workspace API key
from Settings, API Access):

```bash
claude mcp add markaestro -e MARKAESTRO_API_KEY=mk_live_... -- npx -y @markaestro/mcp
```

## Safety

- The user scopes every connection at sign-in: one brand, or all brands in
  the workspace. A single-brand connection cannot reach any other brand; an
  all-brands connection names the brand on each post it creates.
- Agents manage social media, not the account: no tool reaches account
  settings, billing, team members, API keys, webhooks, or channel
  connections, and none deletes a published post, takes one down from a
  platform, or archives an Evergreen queue. The key issued at the agent
  sign-in carries the same limits at the REST layer, so they hold whichever
  client holds the token.
- `create_post` saves a draft unless `scheduledAt` is set. `publish_post` is
  the only tool that publishes immediately; scheduling (`scheduledAt`,
  `bulk_posts`, activating an Evergreen queue) sets up future publishes. The
  skill tells the agent to ask the user before `publish_post` and before
  activating an Evergreen queue.
- Every write tool is annotated `destructiveHint`, so clients that honor tool
  annotations, Claude among them, ask for confirmation before each call.
- Connected agents are listed and revoked in Markaestro under Settings, API.

## Privacy Policy

Markaestro processes the posts, media, and analytics the agent reads or
writes for the brands the connection covers, and nothing from the conversation beyond each
tool call's arguments. Section 7 of the [Privacy Policy](https://markaestro.com/privacy),
"AI agents and connected apps", covers agent connections specifically; the
policy as a whole explains what is collected, how it is used and retained, who it is shared with,
and how to contact us. [Terms of Service](https://markaestro.com/terms).

## Support

Open an issue in this repository, or contact support through
[markaestro.com](https://markaestro.com).

## License

MIT. Copyright (c) 2026 Aethos Solutions LLC.
