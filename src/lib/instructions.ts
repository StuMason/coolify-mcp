/**
 * The server `instructions` field (#339): what a client shows the model before
 * any tool definition. Claude Code loads only tool names and this text at
 * session start and fetches full definitions on demand, so this is where the
 * orientation that the tool names cannot carry has to live.
 *
 * Orientation, not personality: it describes the surface (how tools are
 * shaped, where the safety boundary is, which calls are version-sensitive)
 * and never tells the model how to behave. Nothing here names a resource,
 * a token or a URL; the text is the same for every user of the same mode.
 *
 * Every sentence should be something the model cannot infer from a tool name
 * and would otherwise learn from a failed call. Keep it short: it is paid on
 * every session, so it has a budget in the contract tests like the tool list.
 */

import { TESTED_RANGE } from './doctor.js';

export interface InstructionsOptions {
  /** More than one Coolify instance is configured, so tools take `instance`. */
  fleet: boolean;
  /** The instance used when `instance` is omitted (fleet mode only). */
  defaultInstance: string;
  /** Only read-only tools are registered (MCP_READONLY in HTTP mode). */
  readonly: boolean;
}

export function buildInstructions(options: InstructionsOptions): string {
  const paragraphs: string[] = [
    'coolify-mcp operates a self-hosted Coolify instance through its REST API: applications, databases, services, servers, projects, environments, deployments and their configuration.',

    "Related operations share one tool with an `action` argument, and each tool's `action` enum is the complete list of what it accepts. `list_*` tools return small projections (uuid, name, status); `get_*` tools return one resource in full. `diagnose_app` accepts a uuid, a name or a domain, and `diagnose_server` a uuid, a name or an IP address, so neither needs a lookup call first. Results carry `_actions`, the follow-up calls that apply to that result with their arguments already filled in, and `_pagination` with the next and previous page; both are computed by the server from the real response.",

    '`get_infrastructure_overview` summarises the whole estate in one call, `find_issues` scans it for anything unhealthy, and `diagnose_app` or `diagnose_server` explains one resource. `search_docs` searches the Coolify documentation.',

    options.readonly
      ? 'This server runs in read-only mode: only tools annotated read-only are registered, and nothing here can change the instance.'
      : 'Tools annotated read-only make no change to the instance. Destructive actions (delete, stop, restart, bulk operations) pause and ask the person in their own client before running; a declined confirmation returns a message, not an error, and the operation does not run. Secrets are masked in every response; `env_vars` with `reveal: true` returns the plaintext of one variable and requires its `key`.',

    `Tested against Coolify ${TESTED_RANGE.label}. Tags, destinations and service sub-resource actions need 4.2 or later; the GET-to-POST change in 4.2 is handled by the server, so a 405 means both methods were refused. \`get_version\` reports the Coolify version and \`get_mcp_version\` this server's.`,
  ];

  if (options.fleet) {
    paragraphs.push(
      `This server manages several Coolify instances. Every tool takes an optional \`instance\` argument naming which one; omitted, it is "${options.defaultInstance}". \`list_instances\` reports every instance with its URL and version. Destructive confirmations name the instance they target.`,
    );
  }

  return paragraphs.join('\n\n');
}
