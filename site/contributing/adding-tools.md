# Adding a tool

The order matters. Follow it.

## Order of operations

1. **Verify the endpoint exists in the Coolify API.** Check `docs/openapi-chunks/` first, then cross-reference with the [Coolify source on GitHub](https://github.com/coollabsio/coolify) — the OpenAPI is an incomplete projection of the real allowlists (see [API gotchas](/concepts/coolify-api-gotchas)).
2. **Add the request / response types** to `src/types/coolify.ts`. Always with explicit fields, never `unknown` or `Record<string, unknown>` unless you genuinely don't know the shape.
3. **Add the client method** to `src/lib/coolify-client.ts` with an explicit return type. Pattern:

   ```typescript
   async getResource(uuid: string): Promise<Resource> {
     return this.request<Resource>(`/resources/${uuid}`);
   }
   ```

4. **Add the MCP tool** (or new action on an existing tool) to `src/lib/mcp-server.ts`. Prefer extending an existing tool with a new `action` enum value over adding a new top-level tool — see the consolidation pattern in [how-it-works](/concepts/how-it-works).
5. **Add tests** — both client-level and method-existence (see [Testing](/contributing/testing)).
6. **Update docs** — CHANGELOG entry under `[Unreleased]`, README if tool count changed.

## Code-style rules

- **Explicit return types on every function.** No implicit `any`.
- **Validate inputs at the MCP tool boundary** with zod. The client layer assumes valid inputs.
- **Errors are tool-result errors, not protocol errors.** Wrap fetch failures in `{ content: [{ type: 'text', text: 'Error: ...' }], isError: true }` rather than throwing — the LLM can read and self-correct on tool-result errors.
- **Don't add comments that just describe what the code does.** Comments should explain _why_ — gotchas, intentional asymmetries, surprising constraints. The CLAUDE.md gotcha section is the model.

## Consolidation vs new tool

**Add as a new action on an existing tool when:**

- It operates on the same resource type (application, server, etc.)
- The args list mostly overlaps with the existing tool's args

**Add as a new top-level tool when:**

- It's a genuinely new resource type with its own CRUD lifecycle
- Action+resource consolidation would produce a confusing zod schema

A bad signal: "I added a new tool because the existing tool already has 10 actions." That's fine — `application` already has 12+ actions, that's what the action pattern is for. The point is to avoid duplicating "list/get/create/update/delete" surface across 6 different tools.

## When in doubt

Open an issue first to scope the change. The repo's PR templates ask for the scope and CHANGELOG entry up-front — easier to align on shape before implementation than to rewrite during review.
