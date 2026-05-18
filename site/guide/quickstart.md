# Quickstart

Once [installed](/guide/installation), you can drive Coolify with natural language. Here are five things to try.

## 1. Survey the infrastructure

> "What servers and apps do I have?"

The model uses `get_infrastructure_overview` for a compact summary, or `list_servers` + `list_applications` for more detail.

## 2. Diagnose a sick app

> "Why is `my-app-name` returning 500s?"

The model uses `diagnose_app`, which aggregates application config, recent deployments, logs, and env-var metadata into a single response. It can spot things like "deployment failed 12 minutes ago" or "healthcheck disabled."

## 3. Push a config change

> "Add `LOG_LEVEL=debug` to staging-api as a runtime-only variable."

The model uses `env_vars` with `action: 'create', is_buildtime: false, is_runtime: true`. The runtime-only flag matters — variables marked as build-time get injected as Dockerfile ARG and can break multiline secrets like PEM keys.

## 4. Bulk operation

> "Set `NODE_ENV=production` on every app in the prod environment."

The model uses `bulk_env_update` with the project's app UUIDs. Safer than scripting it manually because the response shows which apps succeeded and which failed.

## 5. Deploy

> "Deploy the latest from main on the api app."

The model uses `deploy` with the application UUID. Currently blocks until the deployment completes. (The v3 [Tasks](/roadmap/v3-vision) primitive will return immediately with a task ID instead.)

## Tools that are read-only (safe to let the model run freely)

- All `list_*` and `get_*` tools
- `diagnose_app`, `diagnose_server`, `find_issues`
- `system({ action: 'health' })`, `system({ action: 'list_resources' })`
- `get_infrastructure_overview`
- `search_docs`

## Tools that change state (consider per-call confirmation in your client)

- All `create_*` / `update_*` / `delete_*` actions
- `deploy`, `redeploy_project`, `restart_*`
- `stop_all_apps` (the nuke button)
- `bulk_env_update`, `bulk_env_delete`

The v2.x tools don't yet declare `destructiveHint` / `readOnlyHint` annotations to drive client confirmation UX — that's a v3 add (see [v3 vision](/roadmap/v3-vision)).
