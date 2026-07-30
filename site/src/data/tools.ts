/** Injected at build time by astro.config.mjs — see countTools() there. */
declare const __TOOL_COUNT__: number;

export const TOOL_COUNT: number = __TOOL_COUNT__;

/**
 * What it can do, described by capability rather than by listing every tool
 * name. A hand-maintained index of 44 identifiers is a maintenance liability
 * and tells a buyer nothing they can act on — the README carries the full list
 * and stays current because it sits next to the code.
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
    d: 'Applications, databases, services, projects and environments — created, changed and removed.',
  },
  {
    t: 'Handle the configuration',
    d: 'Environment variables, volumes, scheduled tasks, backups and SSH keys. Secrets stay masked unless you ask.',
  },
  {
    t: 'Move across the whole estate',
    d: 'One key across many apps, a project redeployed, or everything stopped at once — each behind a human confirmation.',
  },
];
