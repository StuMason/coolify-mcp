# Running a fleet

One server, several Coolify instances: prod and staging, or a Coolify per
region. Available since 3.1.0 in both stdio and HTTP mode.

## Configure it

Add `COOLIFY_INSTANCES`, a JSON array, next to your existing config:

```json
{
  "env": {
    "COOLIFY_BASE_URL": "https://prod.example.com",
    "COOLIFY_ACCESS_TOKEN": "prod-token",
    "COOLIFY_INSTANCES": "[{\"name\":\"staging\",\"url\":\"https://staging.example.com\",\"token\":\"staging-token\"}]"
  }
}
```

Each entry is `{ "name", "url", "token" }` plus an optional
`"headers": { "Key": "Value" }` for an auth proxy in front of that instance.

- **The default instance** is your `COOLIFY_BASE_URL` one, named `default`.
  If you set only `COOLIFY_INSTANCES`, the first entry is the default.
- **Names** are letters, digits, `_`, `-` or `.`, up to 64 characters,
  starting with a letter or digit. `all` is reserved for the planned fan-out
  selector (#367) and is rejected as a name.
- **`CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET`** apply to the default
  instance only. Other instances behind Cloudflare Access carry the pair in
  their own `headers`.
- A malformed entry is a startup error that names the entry (`COOLIFY_INSTANCES[1]`)
  and the problem. Token values are never echoed.

## What changes with two or more instances

- **Every tool takes an optional `instance`**, a name from the list. Omitted
  means the default. A wrong name is rejected with the list of valid names
  before anything is sent anywhere.
- **`list_instances`** reports each instance's name, URL, default flag and
  live Coolify version. Tokens are never shown.
- **Every destructive confirmation names the instance**: "Stop all
  applications on instance staging?" Fat-fingering the wrong estate is the
  failure mode a second instance invents, so the prompt refuses to be
  ambiguous about which one it means.
- **Each instance gets its own client.** A prod on 4.1 next to a staging on
  4.3 each keep their own version handling, method-fallback cache and
  secrets masking.

Single-instance configs are untouched: no `instance` argument, no extra
tool, byte-identical `tools/list`. The fleet surface costs about 900 tokens
of tool schema, and it only exists when there is something to choose between.

## A fleet is one trust domain

Every instance in a `COOLIFY_INSTANCES` list is assumed to belong to the same
owner. Anyone who can call the server can reach every instance in it.

In [HTTP mode](http-mode.md) the OAuth proof-of-access check validates the
token you present against the **default instance only**: proving you belong
to the default proves you belong to the fleet.

**Agencies with a Coolify per client should run one server per client**, not
one fleet. Per-client isolation is the deployment, not the auth layer.
Per-instance OAuth scopes are on the roadmap (#367).

## Not yet

- `doctor` checks the default instance only (#368).
- `instance: "all"` fan-out is designed and reserved, not shipped (#367).
