/**
 * The Coolify version range this release is tested against. Shared by
 * doctor (the version check) and the server instructions (the orientation
 * text), and deliberately its own module so the instructions do not pull the
 * diagnostics CLI into the server's startup graph: `index.ts` loads doctor
 * lazily on purpose.
 */
export const TESTED_RANGE = {
  min: [4, 0] as const,
  max: [4, 3] as const,
  label: '4.0.x – 4.3.x',
};
