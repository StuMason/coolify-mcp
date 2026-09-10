/**
 * Where the Coolify API token comes from, and how it is re-read (#398).
 *
 * ## Why this exists
 *
 * A stdio MCP server is spawned once per client session and lives for the whole
 * of it. `COOLIFY_ACCESS_TOKEN` was read at startup and captured for the life of
 * the process, so rotating the token meant restarting the client session.
 *
 * That was named in writing as a reason for retiring this server in favour of
 * the official CLI, which reads its context on every invocation
 * (pedrorezendefig/hospital-reunioes#312). It matters more than it looks:
 * rotation is the remediation step for a leaked token, so the moment somebody
 * most needs a new token to take effect is the moment we made them restart
 * everything.
 *
 * ## Why a file, and not just the environment
 *
 * A spawned subprocess does not see later changes to its parent's environment.
 * Exporting a new value in a shell cannot reach a server that is already
 * running, so an env-only design cannot support rotation no matter how often it
 * re-reads. `COOLIFY_ACCESS_TOKEN_FILE` points at a path, and the value is
 * re-read when the file's mtime changes — the same shape as a Kubernetes or
 * Docker secret mount, and what makes `coolify context set-token` style
 * rotation possible for us.
 *
 * The environment variable keeps working unchanged and stays the default.
 */

import { readFileSync, statSync } from 'node:fs';

export interface TokenSourceInfo {
  /** Where the current value came from. */
  origin: 'env' | 'file';
  /** The path, when the origin is a file. */
  path?: string;
  /** When the value was last read from disk, epoch ms. Undefined for `env`. */
  lastReadAt?: number;
}

/**
 * Resolves the token on demand.
 *
 * `current()` is called on every request, so the file case stats before reading
 * and only re-reads when the mtime moved. A stat per API call is a local
 * syscall against a file the OS has cached; re-reading unconditionally would be
 * wasteful, and caching without the stat would be the bug this module exists to
 * fix.
 */
export class TokenSource {
  private readonly path?: string;
  private value: string;
  private mtimeMs = 0;
  private lastReadAt?: number;

  constructor(config: { accessToken?: string; accessTokenFile?: string }) {
    if (config.accessTokenFile) {
      this.path = config.accessTokenFile;
      // Read once here so a missing or empty file fails at construction, where
      // the message can name the path, rather than as a 401 on the first call.
      this.value = this.readFile();
      return;
    }
    if (!config.accessToken) {
      throw new Error('Coolify access token is required');
    }
    this.value = config.accessToken;
  }

  current(): string {
    if (!this.path) return this.value;
    let mtimeMs: number;
    try {
      mtimeMs = statSync(this.path).mtimeMs;
    } catch {
      // The file went away while we were running. Keeping the last good value
      // is the kinder failure: a transient unmount or an atomic replace that
      // briefly unlinks should not take down a working server, and if the
      // token really is gone the next call gets a 401 that says so.
      return this.value;
    }
    if (mtimeMs !== this.mtimeMs) {
      try {
        this.value = this.readFile();
      } catch {
        // Same reasoning: a half-written file is a moment, not a state.
      }
    }
    return this.value;
  }

  /**
   * Force a re-read, ignoring the mtime cache, and say whether the value moved.
   *
   * Used on a 401: an editor that writes in place can leave mtime granularity
   * ambiguity, and more importantly a rotation that lands mid-request should
   * recover rather than surface an error the user cannot act on.
   */
  refresh(): { changed: boolean } {
    if (!this.path) return { changed: false };
    const before = this.value;
    try {
      this.value = this.readFile();
    } catch {
      return { changed: false };
    }
    return { changed: this.value !== before };
  }

  info(): TokenSourceInfo {
    return this.path
      ? { origin: 'file', path: this.path, lastReadAt: this.lastReadAt }
      : { origin: 'env' };
  }

  private readFile(): string {
    const raw = readFileSync(this.path as string, 'utf8');
    // `echo token > file` appends a newline, and a Bearer header carrying one
    // is rejected as malformed rather than as a bad token — an error that
    // sends people hunting for a permissions problem they do not have.
    const token = raw.trim();
    if (!token) {
      throw new Error(`Coolify access token file is empty: ${this.path}`);
    }
    try {
      this.mtimeMs = statSync(this.path as string).mtimeMs;
    } catch {
      this.mtimeMs = 0;
    }
    this.lastReadAt = Date.now();
    return token;
  }
}
