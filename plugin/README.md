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
with no credentials, so Claude Code uses OAuth. The URL is fixed rather than
read from an environment variable, so every host that loads the plugin
reaches the same server. For headless use with a static key, or to point at
a local build, register the server yourself instead:

```bash
claude mcp add --transport http markaestro https://markaestro.com/api/public/v1/mcp \
  --header "Authorization: Bearer mk_live_..."
```

## Example prompts

- "What did we post on Instagram last month, and which three posts got the
  most engagement?"
- "Draft a LinkedIn post announcing our new cold brew and schedule it for
  Tuesday at 9am New York time. Don't publish anything else."
- "When does our audience respond best? Put next week's three drafts in
  those slots."

## Other clients

The plugin is Claude Code specific, but the server is not. Cursor, ChatGPT,
Grok, Grok Bot, OpenClaw, Hermes, and any other MCP client connect to the
same `https://markaestro.com/api/public/v1/mcp` with their own config; each
one has a tab with exact steps at
https://markaestro.com/developers/agents (add `?client=cursor`, `chatgpt`,
`grok`, `grok-bot`, `openclaw`, or `hermes` to open it directly). The skill
in this repository is client-agnostic and can be installed from ClawHub or
by URL where the client supports Agent Skills.
