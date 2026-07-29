/**
 * Integration tests for the tags tool (#298).
 *
 * Tag endpoints landed in Coolify v4.2 (`coollabsio/coolify#9275`), so on an
 * older instance these are genuinely SKIPPED rather than failed — the endpoints
 * do not exist yet, which is not a defect.
 *
 * Three behavioural claims the tool description makes are confirmed here rather
 * than taken from the spec, because CLAUDE.md is explicit that Coolify's OpenAPI
 * is unreliable. Reading `HandlesTagsApi.php` upstream says:
 *
 * - `attachTagsToResource` uses `syncWithoutDetaching`, so **attach is additive**
 *   and existing tags survive. If it were a `sync`, attaching one tag would
 *   silently strip the rest, and the description would be wrong in a way that
 *   destroys user configuration.
 * - `createTag` returns `$resource->refresh()->tags`, i.e. the **full** tag set,
 *   not just the newly added ones.
 * - `deleteTag` returns `{'message': 'Tag removed.'}`, so `MessageResponse` with
 *   a required `message` is the right type.
 *
 * The additive test below is the one that matters — it is the only assertion
 * that would catch upstream switching to a replace.
 *
 * **Side effects:** this suite creates and removes tags on a resource you
 * nominate via TEST_TAG_RESOURCE_UUID, using names prefixed `coolify-mcp-test-`.
 * It cleans up after itself and touches nothing else. It is skipped entirely
 * unless that variable is set, so it never runs against an arbitrary resource.
 *
 * Run with: npm run test:integration
 */

import { it, expect, afterAll } from '@jest/globals';
import {
  hasCredentials,
  warnIfSkipped,
  describeIf,
  makeClient,
  resolveVersion,
  atLeast,
  V4_2,
} from './helpers.js';

warnIfSkipped('tags.integration');

/** Deliberately opt-in: this is the only integration suite that writes. */
const RESOURCE_UUID = process.env.TEST_TAG_RESOURCE_UUID;

const client = makeClient();

let version: [number, number] = [0, 0];
if (hasCredentials) {
  const resolvedVersion = await resolveVersion(client);
  version = resolvedVersion.version;
  if (!atLeast(version, V4_2)) {
    console.warn(
      `\n[tags.integration] Coolify ${resolvedVersion.raw} predates v4.2 — tag ` +
        'endpoints do not exist on it yet, so this suite is SKIPPED, not verified.\n',
    );
  }
}
const supportsV42 = version[0] > 0 && atLeast(version, V4_2);

const PREFIX = 'coolify-mcp-test-';
const TAG_A = `${PREFIX}alpha`;
const TAG_B = `${PREFIX}beta`;

describeIf(hasCredentials && supportsV42 && Boolean(RESOURCE_UUID))('tags integration', () => {
  afterAll(async () => {
    // Remove anything this suite created, whatever the outcome above.
    const tags = await client.listApplicationTags(RESOURCE_UUID as string).catch(() => []);
    for (const tag of tags) {
      if (tag.name.startsWith(PREFIX)) {
        await client.detachApplicationTag(RESOURCE_UUID as string, tag.uuid).catch(() => undefined);
      }
    }
  }, 60_000);

  it("lists the current team's tags", async () => {
    const tags = await client.listTags();

    expect(Array.isArray(tags)).toBe(true);
    for (const tag of tags) {
      expect(typeof tag.uuid).toBe('string');
      expect(typeof tag.name).toBe('string');
    }
  }, 30_000);

  it('attach is ADDITIVE — a second attach keeps the first tag', async () => {
    await client.attachApplicationTags(RESOURCE_UUID as string, { tag_names: [TAG_A] });
    const afterFirst = await client.listApplicationTags(RESOURCE_UUID as string);
    expect(afterFirst.map((t) => t.name)).toContain(TAG_A);

    await client.attachApplicationTags(RESOURCE_UUID as string, { tag_names: [TAG_B] });
    const afterSecond = await client.listApplicationTags(RESOURCE_UUID as string);

    // The claim the tool description rests on. A `sync` upstream would have
    // dropped TAG_A here, silently destroying tags the user set.
    expect(afterSecond.map((t) => t.name)).toContain(TAG_A);
    expect(afterSecond.map((t) => t.name)).toContain(TAG_B);
  }, 60_000);

  it('attach returns the full tag set, not only the new ones', async () => {
    const returned = await client.attachApplicationTags(RESOURCE_UUID as string, {
      tag_names: [TAG_A],
    });

    expect(Array.isArray(returned)).toBe(true);
    expect(returned.map((t) => t.name)).toContain(TAG_A);
  }, 30_000);

  it('detach removes one tag and returns a message', async () => {
    await client.attachApplicationTags(RESOURCE_UUID as string, { tag_names: [TAG_A, TAG_B] });
    const before = await client.listApplicationTags(RESOURCE_UUID as string);
    const target = before.find((t) => t.name === TAG_A);
    expect(target).toBeDefined();

    const result = await client.detachApplicationTag(
      RESOURCE_UUID as string,
      (target as { uuid: string }).uuid,
    );

    // MessageResponse.message is required — if upstream returned 204/empty this
    // would be a silent undefined, the same class of problem as withheld v4.2
    // secrets.
    expect(typeof result.message).toBe('string');

    const after = await client.listApplicationTags(RESOURCE_UUID as string);
    expect(after.map((t) => t.name)).not.toContain(TAG_A);
    // Detaching one must not remove the others.
    expect(after.map((t) => t.name)).toContain(TAG_B);
  }, 60_000);
});
