/**
 * Was this 404 body produced by Coolify's routing catch-all rather than a
 * controller?
 *
 * `routes/api.php` ends with `Route::any('/{any}', ...)` returning
 * `{ message: 'Not found.', docs: 'https://coolify.io/docs' }`. That `docs`
 * key is the signature — no controller 404 carries it — so it distinguishes
 * "this method/path is not routed" (no middleware or controller ran) from
 * "the resource does not exist". The distinction is load-bearing twice: the
 * client's v4.2 method fallback only retries routing misses, and doctor's
 * ability probe must never read a routing miss as evidence of anything.
 *
 * One definition, shared, so the client and doctor cannot drift apart —
 * doctor's api-shape check exists to verify exactly what the client does.
 */
export function isRoutingCatchAllBody(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) return false;
  // `docs` is the strongest signal, but a proxy or a future Coolify could drop
  // it. The catch-all's exact wording is a cheap second discriminator — a
  // controller says "<Resource> not found.", never a bare "Not found.".
  if ('docs' in body) return true;
  return (body as { message?: unknown }).message === 'Not found.';
}
