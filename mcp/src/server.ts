import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MarkaestroClient, DEFAULT_BASE_URL } from "./client";
import { CHANNEL_RULES, createTools, describeError } from "./tools";
import { VERSION } from "./version";

export const SERVER_VERSION = VERSION;

export type ServerOptions = {
  /** Register only read-only tools. Set MARKAESTRO_READ_ONLY=1 to get this from the environment. */
  readOnly?: boolean;
};

export function serverOptionsFromEnv(env: Record<string, string | undefined> = process.env): ServerOptions {
  return { readOnly: env.MARKAESTRO_READ_ONLY === "1" || env.MARKAESTRO_READ_ONLY === "true" };
}

export function clientFromEnv(env: Record<string, string | undefined> = process.env): MarkaestroClient {
  const apiKey = env.MARKAESTRO_API_KEY;
  if (!apiKey) {
    throw new Error("Set MARKAESTRO_API_KEY to a workspace API key (Settings > API Access in Markaestro).");
  }
  return new MarkaestroClient({ apiKey, baseUrl: env.MARKAESTRO_BASE_URL || DEFAULT_BASE_URL });
}

export function buildServer(client: MarkaestroClient, options: ServerOptions = {}): McpServer {
  const server = new McpServer({ name: "markaestro", version: SERVER_VERSION }, {
    instructions: [
      "Markaestro schedules and publishes social posts. A connection covers one brand or every brand in its workspace.",
      "Start with list_products, then list_destinations when a channel needs a destinationId. If list_products returns several brands, pass productId when creating posts or Evergreen queues.",
      "create_post saves a draft unless scheduledAt is set. publish_post publishes now; ask the user before publishing anything public.",
      "Upload media with upload_media before referencing it. Read get_channel_rules for per-channel limits, and get_brand_profile before writing captions.",
      "Edit drafts and scheduled posts with update_post. Agents cannot delete published posts or change account settings, billing, team, keys, or channel connections; send the user to Markaestro for those.",
      "Use preview_evergreen_queue before creating an Intelligent Evergreen queue, and get explicit confirmation before activation.",
      "Read get_analytics and list_post_analytics before recommending what, when, or where to post; get_post_analytics_history shows how one post earned its numbers.",
      options.readOnly ? "This server is read-only: only listing and reading tools are available." : "",
    ].filter(Boolean).join(" "),
  });

  for (const tool of createTools(client)) {
    if (options.readOnly && !tool.readOnly) continue;
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: {
          readOnlyHint: tool.readOnly,
          destructiveHint: !tool.readOnly && tool.destructive !== false,
          idempotentHint: tool.readOnly,
          openWorldHint: tool.openWorld ?? false,
        },
      },
      async (args: Record<string, unknown>) => {
        try {
          const result = await tool.handler(args ?? {});
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
          return { isError: true, content: [{ type: "text", text: describeError(error) }] };
        }
      },
    );
  }

  server.registerResource(
    "channel-rules",
    "markaestro://channel-rules",
    { title: "Channel rules", description: "Per-channel media, caption, and delivery-mode rules.", mimeType: "text/plain" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/plain", text: CHANNEL_RULES }] }),
  );

  server.registerPrompt(
    "schedule_post",
    {
      title: "Schedule a post",
      description: "Walk through creating and scheduling a post for this brand.",
      argsSchema: { brief: z.string().optional().describe("What to post, and when. Leave empty to be asked.") },
    },
    ({ brief }: { brief?: string }) => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: [
            "Schedule a Markaestro post from this brief:",
            brief || "(no brief given; ask me what to post)",
            "",
            "Steps: call get_channel_rules and list_products; pick channels the brand has connected; upload any media with upload_media; create the post with create_post using scheduledAt in UTC and an explicit deliveryMode for facebook, instagram, or tiktok; then show me the post id, status, and scheduled time. Do not call publish_post unless I ask.",
          ].join("\n"),
        },
      }],
    }),
  );

  return server;
}
