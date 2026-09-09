/** Injected at build time by astro.config.mjs — see countTools() and readVersion() there. */
declare const __TOOL_COUNT__: number;
declare const __VERSION__: string;

export const TOOL_COUNT: number = __TOOL_COUNT__;
export const VERSION: string = __VERSION__;

export const REPO = 'https://github.com/StuMason/coolify-mcp';

/**
 * What it can do, described by capability rather than by listing every tool
 * name. A hand-maintained index of 45 identifiers is a maintenance liability
 * and tells a buyer nothing they can act on — docs/tools.md carries the full
 * list and stays current because it sits next to the code.
 */
export const CAPABILITIES: { t: string; d: string }[] = [
  {
    t: 'Work out what is wrong',
    d: 'Diagnose an app or a server in one call, read container logs, and scan the whole estate for problems.',
  },
  {
    t: 'Deploy and roll back',
    d: 'Trigger deploys by tag or uuid, watch them, cancel them, and start, stop or restart anything.',
  },
  {
    t: 'Create and destroy',
    d: 'Applications, databases, services, projects and environments: created, changed and removed.',
  },
  {
    t: 'Handle the configuration',
    d: 'Environment variables, volumes, scheduled tasks, backups and SSH keys. Secrets stay masked unless you ask.',
  },
  {
    t: 'Move across the whole estate',
    d: 'One key across many apps, a project redeployed, or everything stopped at once, each behind a human confirmation.',
  },
  {
    t: 'Run several Coolifys',
    d: 'Prod, staging and a per-region instance from one server. Every tool takes an instance; every confirmation names it.',
  },
];

/**
 * The reference, which lives in the repo next to the code. The site links out
 * rather than mirroring it: a second copy is a second thing to keep honest.
 * Also the table of contents for /llms.txt.
 */
export const DOCS: { t: string; d: string; file: string }[] = [
  {
    t: 'Tool reference',
    d: 'Every tool by category, how the surface is shaped, Coolify version compatibility and the upstream gotchas already handled.',
    file: 'docs/tools.md',
  },
  {
    t: 'Remote: HTTP mode',
    d: 'Run it as a container inside Coolify and connect claude.ai or Claude Code over OAuth 2.1. Five-minute install, every mistake we made.',
    file: 'docs/http-mode.md',
  },
  {
    t: 'Prompts and resources',
    d: 'Guided workflows you start as slash commands, and reads a client can attach. Why a prompt never fetches, and why a resource can never bypass masking.',
    file: 'docs/prompts-and-resources.md',
  },
  {
    t: 'Fleet',
    d: 'Several Coolify instances from one server: COOLIFY_INSTANCES, the instance argument, and why a fleet is one trust domain.',
    file: 'docs/fleet.md',
  },
  {
    t: 'Doctor',
    d: 'npx @masonator/coolify-mcp doctor: what each check proves, exit codes, and what it deliberately does not guess.',
    file: 'docs/doctor.md',
  },
  {
    t: 'Safety and security',
    d: 'Human confirmation on destructive operations, secrets masked at the API boundary, and how to report a vulnerability.',
    file: 'docs/security.md',
  },
  {
    t: 'Changelog',
    d: 'Every release, what changed and why, with upgrade notes.',
    file: 'CHANGELOG.md',
  },
];

export const docUrl = (file: string): string => `${REPO}/blob/main/${file}`;
export const rawUrl = (file: string): string =>
  `https://raw.githubusercontent.com/StuMason/coolify-mcp/main/${file}`;
