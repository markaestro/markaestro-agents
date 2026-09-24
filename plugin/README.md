# Markaestro plugin for Claude Code

Bundles the `markaestro` skill and the hosted MCP server.

```bash
claude plugin marketplace add markaestro/markaestro-agents
claude plugin install markaestro@markaestro
```

That is the whole setup. The first Markaestro tool call opens your browser:
sign in, pick the workspace and brand the agent may act on, click Allow. To
sign in again later, or switch brands, run `/mcp` and choose `markaestro`.

The MCP server entry points at `https://markaestro.com/api/public/v1/mcp`
with no credentials, so Claude Code uses OAuth. Set `MARKAESTRO_BASE_URL` to
point a local build at another host. For headless use with a static key,
register the server yourself instead:

```bash
claude mcp add --transport http markaestro https://markaestro.com/api/public/v1/mcp \
  --header "Authorization: Bearer mk_live_..."
```

## Other clients

The plugin is Claude Code specific, but the server is not. Cursor, ChatGPT,
Grok, Grok Bot, OpenClaw, Hermes, and any other MCP client connect to the
same `https://markaestro.com/api/public/v1/mcp` with their own config; each
one has a tab with exact steps at
https://markaestro.com/developers/agents (add `?client=cursor`, `chatgpt`,
`grok`, `grok-bot`, `openclaw`, or `hermes` to open it directly). The skill
in this repository is client-agnostic and can be installed from ClawHub or
by URL where the client supports Agent Skills.
