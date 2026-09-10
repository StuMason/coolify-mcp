# Prompts and resources

The server exposes three things over MCP, not one. Tools are what a model
calls. **Prompts** are workflows you start. **Resources** are reads a client
can attach. They are separate lists over separate protocol methods, so the
tool surface and its token budget are unchanged by anything on this page.

## Prompts

A prompt is a guided workflow. Your client shows it as something you pick —
a slash command in Claude Code, an entry in the prompt menu in Claude
Desktop — and picking it drops an opening instruction into the conversation.
The model then does the work with the ordinary tools.

| Prompt                     | Argument                      | What it does                                                                                       |
| -------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------- |
| `troubleshoot_application` | `query`: name, UUID or domain | Status and log tail first, then configuration, ending in a most-likely cause and the smallest fix. |
| `explain_failed_deploy`    | `deployment_uuid`             | Reads the build log, says which stage broke, quotes the evidence and names the fix.                |
| `estate_health`            | none                          | Known issues plus a status sweep across the estate, worst first.                                   |

In fleet mode each one also takes an optional `instance`, exactly as the tools
do. Omitting it means the default instance, and `estate_health` says which
instance it covered and which it did not, so "the estate" is never silently
read as "the whole fleet".

### Prompts make no API call

`prompts/get` returns text and nothing else. The server does not fetch
anything on your behalf when you pick a prompt, which is deliberate for two
reasons. A prompt that pre-fetched would turn a slash command into a
multi-second stall that can fail with an error you cannot act on. And build
and container output is attacker-influenceable, so embedding it in the
returned message would place it in a user-role message, outside the untrusted
-data boundary that the tool layer puts around exactly that text. Naming the
tool and letting the model call it keeps the log on the one path that frames
it as data. See [security](security.md).

### A prompt whose tools are missing does not appear

Read-only mode does not register mutating tools, and two pure reads sit under
destructive tools because of consolidation: listing env vars and getting a
deployment. So on a read-only server:

- `explain_failed_deploy` is **not listed at all**. The build log is reachable
  only through the `deployment` tool, so the workflow cannot run, and a slash
  command that dead-ends is worse than no slash command.
- `troubleshoot_application` is listed, with its env-var step dropped.
- `estate_health` is unchanged; it only ever used read-only tools.

## Resources

A resource is a read your client can attach to a conversation, the way it
would attach a file. Two exist.

| URI                            | Contents                                                                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `coolify://overview`           | Counts and current status for every server, project, application, database and service. The same snapshot `get_infrastructure_overview` returns. |
| `coolify://application/{uuid}` | Full configuration and status for one application.                                                                                               |

Every application on the instance is listed as a concrete entry, so you can
pick one rather than knowing its UUID. In fleet mode the URIs carry the
instance — `coolify://staging/overview`,
`coolify://staging/application/{uuid}` — because reading production's overview
while believing it is staging's is the mistake a second instance invents.

### Resources cannot bypass masking

Every resource read goes through the same client as every tool call, so the
central sanitizer masks credentials on the way out. A resource read returns
exactly the payload the equivalent tool returns, and the contract suite
asserts that byte for byte rather than assuming it.

There is deliberately no `reveal` on any resource URI. `get_application` takes
`reveal: true` because a caller justifies it in the moment; a resource URI is
a durable handle a client may cache, re-read or paste, which is the last place
to put an opt-in to plaintext secrets. If you need a secret, use the tool.

## Client support varies

Prompts and resources are optional parts of MCP and clients implement them
unevenly. Prompts appear as slash commands in Claude Code and in the prompt
menu in Claude Desktop. Resources appear as attachments in Claude Desktop and
by mention in Claude Code. A client that supports neither loses nothing: every
workflow here is reachable through the tools it already has.
