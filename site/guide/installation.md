# Installation

coolify-mcp ships as an npm package. Any MCP-aware client that can spawn an `npx` command can run it.

## Prerequisites

- A running Coolify instance (v4+)
- A Coolify API token with appropriate scope ([create one in Settings → API](https://coolify.io/docs/api-reference/authentication))
- Node.js 20+ on the machine running the MCP client

## Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or the equivalent on your OS. Add:

```json
{
  "mcpServers": {
    "coolify": {
      "command": "npx",
      "args": ["-y", "@masonator/coolify-mcp"],
      "env": {
        "COOLIFY_BASE_URL": "https://your-coolify.example.com",
        "COOLIFY_ACCESS_TOKEN": "your-api-token"
      }
    }
  }
}
```

Restart Claude Desktop. The hammer icon in the chat input should show coolify's tools.

## Claude Code

Add to `~/.claude.json` under `mcpServers`, same shape as Claude Desktop. Or use the CLI:

```bash
claude mcp add coolify -- npx -y @masonator/coolify-mcp \
  --env COOLIFY_BASE_URL=https://your-coolify.example.com \
  --env COOLIFY_ACCESS_TOKEN=your-api-token
```

## Cursor

Settings → Tools & Integrations → MCP. Same JSON shape as above.

## Per-workspace config (multi-Coolify)

If you manage multiple Coolify instances, most MCP clients let you scope the server to a workspace by putting the config in `.cursor/mcp.json` or `.claude/mcp.json` in the repo root. The client spawns a fresh process per workspace with the right env vars. No code changes needed.

## Custom HTTP headers

For Coolify instances behind Cloudflare Zero Trust or other middleware:

```json
{
  "args": [
    "-y",
    "@masonator/coolify-mcp",
    "--header",
    "CF-Access-Client-Id: ...",
    "--header",
    "CF-Access-Client-Secret: ..."
  ]
}
```

Reserved headers (`Authorization`, `Content-Type`) are filtered with a warning to prevent overriding the bearer token.

## Verifying

In your MCP client, ask: _"What's the Coolify version?"_

The model should invoke `get_version` and reply with your Coolify's version string. If you get an auth error, the token is wrong. If you get a connection error, the URL is wrong or unreachable from the client's machine.
