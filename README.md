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

**Claude (claude.ai and Claude Desktop):** open Customize, Connectors, click
Add custom connector, paste `https://markaestro.com/api/public/v1/mcp`, leave
the OAuth client fields empty, and click Add. Click Connect to sign in.

**Cursor, ChatGPT, Grok, OpenClaw, Hermes, and other clients:** step by step
instructions for each are at
[markaestro.com/developers/agents](https://markaestro.com/developers/agents).

**Skill only** (Claude Code, Cursor, Codex, Copilot, Gemini, and other agents
that read skills; listed on [skills.sh](https://skills.sh/markaestro/markaestro-agents/markaestro)):

```bash
npx skills add markaestro/markaestro-agents
```

**OpenClaw** (listed on [ClawHub](https://clawhub.ai/markaestro/skills/markaestro)):

```bash
clawhub install markaestro
```

**Local package** (reads media from your own disk; needs a workspace API key
from Settings, API Access):

```bash
claude mcp add markaestro -e MARKAESTRO_API_KEY=mk_live_... -- npx -y @markaestro/mcp
```

## Example prompts

- "What did we post on Instagram last month, and which three posts got the
  most engagement?"
- "Draft a LinkedIn post announcing our new cold brew and schedule it for
  Tuesday at 9am New York time. Don't publish anything else."
- "When does our audience respond best? Put next week's three drafts in
  those slots."

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
- Every tool declares `readOnlyHint`, `destructiveHint`, and `openWorldHint`
  explicitly, set from what it does: `destructiveHint` on tools that edit,
  remove, unschedule, or publish (`update_post`, `delete_post`, `bulk_posts`,
  `publish_post`, `update_evergreen_queue`, `pause_evergreen_queue`), and
  `openWorldHint` on tools that can change what appears on a platform, now or
  on a schedule. Clients that honor annotations, Claude among them, ask for
  confirmation before writes.
- Connected agents are listed and revoked in Markaestro under Settings, API.

## Privacy Policy

Markaestro processes the posts, media, and analytics the agent reads or
writes for the brands the connection covers, and nothing from the conversation beyond each
tool call's arguments. Section 7 of the [Privacy Policy](https://markaestro.com/privacy),
"AI agents and connected apps", covers agent connections specifically; the
policy as a whole explains what is collected, how it is used and retained, who it is shared with,
and how to contact us. [Terms of Service](https://markaestro.com/terms).

## Support

Email [support@markaestro.com](mailto:support@markaestro.com), use the
[contact page](https://markaestro.com/contact), or open an issue in this
repository. If a sign-in or tool call fails, include the `requestId` from the
error; it lets support trace the call. Report security vulnerabilities
privately to support@markaestro.com rather than in a public issue.

## License

MIT. Copyright (c) 2026 Aethos Solutions LLC.
