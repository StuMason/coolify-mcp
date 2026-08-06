/**
 * OAuth 2.1 authorization server for HTTP mode (#303).
 *
 * The design decision that shapes everything here: this AS authenticates the
 * human to the container, it does not broker Coolify credentials. The
 * container acts with its own env-var Coolify token; the client only ever
 * holds a short-lived, audience-bound, revocable MCP token. There is no
 * secrets database — the store below holds OAuth artefacts only (registered
 * clients, one-time codes, token hashes), never a Coolify credential.
 *
 * Tier-2 authorisation ("Coolify token as proof of access"): at authorize
 * time the user presents their own Coolify API token, the caller validates it
 * against `GET /teams/current` (a bad token 401s) and then discards it. The
 * proof never enters this module and is never stored — `completeAuthorization`
 * runs strictly after validation and receives no token.
 *
 * OAuth 2.1 requirements implemented: PKCE S256 on every code flow (plain is
 * rejected), exact redirect-URI matching, single-use short-lived codes,
 * rotating refresh tokens with reuse detection (a replayed refresh token
 * revokes the whole grant family, per the OAuth 2.1 BCP), and RFC 8707
 * resource binding so a token issued for this server cannot be replayed
 * against another.
 *
 * Tokens are opaque random strings; the store keeps only their SHA-256, so
 * the persisted state file contains nothing directly usable.
 */

import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { OAuthError as SdkOAuthError, OAuthErrorCode } from '@modelcontextprotocol/server';

/** RFC 7591 client metadata subset we accept and persist. */
export interface RegisteredClient {
  client_id: string;
  client_name?: string;
  redirect_uris: string[];
  /** 'none' (public + PKCE) or 'client_secret_post'. */
  token_endpoint_auth_method: string;
  /** Present only for confidential clients. Stored hashed. */
  client_secret_hash?: string;
  created_at: number;
}

interface AuthorizationCode {
  /** SHA-256 of the code handed to the client. */
  code_hash: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  scope: string;
  resource: string;
  /** Grant family — every token descended from this code shares it. */
  grant_id: string;
  expires_at: number;
}

interface StoredToken {
  /** SHA-256 of the token handed to the client. */
  token_hash: string;
  kind: 'access' | 'refresh';
  client_id: string;
  scope: string;
  resource: string;
  grant_id: string;
  expires_at: number;
  revoked: boolean;
  /** Refresh only: set when this token has been rotated away. */
  rotated: boolean;
}

interface OAuthState {
  clients: RegisteredClient[];
  codes: AuthorizationCode[];
  tokens: StoredToken[];
}

/** Matches the SDK's AuthInfo shape so the verifier can return it directly. */
export interface VerifiedAccessToken {
  token: string;
  clientId: string;
  scopes: string[];
  expiresAt: number;
  resource?: URL;
}

export class OAuthErrorResponse extends Error {
  constructor(
    public readonly code: string,
    public readonly description: string,
    public readonly status: number = 400,
  ) {
    super(`${code}: ${description}`);
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function opaque(prefix: string): string {
  return `${prefix}_${randomBytes(32).toString('base64url')}`;
}

/**
 * Strip a hash fragment and normalize for RFC 8707 comparison, mirroring the
 * spec's rule that resource identifiers are compared without fragments.
 */
export function canonicalResource(value: string): string {
  const url = new URL(value);
  url.hash = '';
  return url.href.replace(/\/$/, '');
}

export interface OAuthProviderOptions {
  /** Public issuer URL, e.g. https://mcp.example.com */
  issuer: string;
  /** The protected resource identifier tokens must be bound to (the /mcp URL). */
  resource: string;
  /** Access token lifetime in seconds. */
  accessTokenTtl: number;
  /** Refresh token lifetime in seconds. Short by design: revocation propagates at re-auth. */
  refreshTokenTtl: number;
  /** Where OAuth state persists. Empty string keeps everything in memory (tests). */
  stateFile: string;
}

export class OAuthProvider {
  private readonly clients = new Map<string, RegisteredClient>();
  private readonly codes = new Map<string, AuthorizationCode>();
  private readonly tokens = new Map<string, StoredToken>();
  private persistTimer: NodeJS.Timeout | null = null;

  constructor(private readonly options: OAuthProviderOptions) {
    this.load();
  }

  // ===========================================================================
  // Metadata (RFC 8414 / RFC 9728)
  // ===========================================================================

  authorizationServerMetadata(): Record<string, unknown> {
    const issuer = this.options.issuer;
    return {
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      registration_endpoint: `${issuer}/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
      scopes_supported: ['coolify'],
    };
  }

  protectedResourceMetadata(): Record<string, unknown> {
    return {
      resource: this.options.resource,
      authorization_servers: [this.options.issuer],
      bearer_methods_supported: ['header'],
      scopes_supported: ['coolify'],
    };
  }

  // ===========================================================================
  // Dynamic client registration (RFC 7591)
  // ===========================================================================

  registerClient(metadata: Record<string, unknown>): Record<string, unknown> {
    const redirectUris = metadata.redirect_uris;
    if (
      !Array.isArray(redirectUris) ||
      redirectUris.length === 0 ||
      !redirectUris.every((u) => typeof u === 'string')
    ) {
      throw new OAuthErrorResponse('invalid_client_metadata', 'redirect_uris is required');
    }
    for (const uri of redirectUris as string[]) {
      let parsed: URL;
      try {
        parsed = new URL(uri);
      } catch {
        throw new OAuthErrorResponse('invalid_redirect_uri', `not a valid URL: ${uri}`);
      }
      const isLoopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
      if (parsed.protocol !== 'https:' && !isLoopback) {
        throw new OAuthErrorResponse(
          'invalid_redirect_uri',
          'redirect_uris must be https (loopback excepted)',
        );
      }
    }

    const method =
      typeof metadata.token_endpoint_auth_method === 'string'
        ? metadata.token_endpoint_auth_method
        : 'none';
    if (method !== 'none' && method !== 'client_secret_post') {
      throw new OAuthErrorResponse(
        'invalid_client_metadata',
        'token_endpoint_auth_method must be none or client_secret_post',
      );
    }

    const client: RegisteredClient = {
      client_id: opaque('mcp_client'),
      client_name: typeof metadata.client_name === 'string' ? metadata.client_name : undefined,
      redirect_uris: redirectUris as string[],
      token_endpoint_auth_method: method,
      created_at: Date.now(),
    };

    let clientSecret: string | undefined;
    if (method === 'client_secret_post') {
      clientSecret = opaque('mcp_secret');
      client.client_secret_hash = sha256(clientSecret);
    }

    this.clients.set(client.client_id, client);
    this.persist();

    return {
      client_id: client.client_id,
      ...(clientSecret ? { client_secret: clientSecret } : {}),
      client_name: client.client_name,
      redirect_uris: client.redirect_uris,
      token_endpoint_auth_method: client.token_endpoint_auth_method,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    };
  }

  // ===========================================================================
  // Authorization endpoint
  // ===========================================================================

  /**
   * Validate the query half of an authorization request. Called on GET (to
   * decide whether to render the consent form at all) and again on POST
   * before issuing a code. Throws {@link OAuthErrorResponse} on anything
   * malformed; per spec, redirect-uri and client-id problems must NOT
   * redirect, so the caller renders those as a plain error page.
   */
  validateAuthorizationRequest(params: URLSearchParams): {
    client: RegisteredClient;
    redirectUri: string;
    codeChallenge: string;
    scope: string;
    resource: string;
    state: string | null;
  } {
    const clientId = params.get('client_id') ?? '';
    const client = this.clients.get(clientId);
    if (!client) {
      throw new OAuthErrorResponse('invalid_client', 'unknown client_id', 401);
    }

    const redirectUri = params.get('redirect_uri') ?? '';
    if (!client.redirect_uris.includes(redirectUri)) {
      throw new OAuthErrorResponse('invalid_request', 'redirect_uri not registered for client');
    }

    if (params.get('response_type') !== 'code') {
      throw new OAuthErrorResponse('unsupported_response_type', 'only code is supported');
    }

    const codeChallenge = params.get('code_challenge') ?? '';
    if (!codeChallenge || params.get('code_challenge_method') !== 'S256') {
      throw new OAuthErrorResponse(
        'invalid_request',
        'PKCE with code_challenge_method=S256 is required',
      );
    }

    const resource = params.get('resource');
    if (resource && canonicalResource(resource) !== canonicalResource(this.options.resource)) {
      throw new OAuthErrorResponse('invalid_target', 'resource does not identify this server');
    }

    return {
      client,
      redirectUri,
      codeChallenge,
      scope: params.get('scope') || 'coolify',
      resource: canonicalResource(resource || this.options.resource),
      state: params.get('state'),
    };
  }

  /**
   * Issue an authorization code. The caller MUST have completed
   * proof-of-access first (tier 2: the presented Coolify token validated
   * against `/teams/current` and discarded) — this method deliberately takes
   * no credential, so there is nothing here to store or leak.
   */
  completeAuthorization(request: ReturnType<OAuthProvider['validateAuthorizationRequest']>): {
    redirectTo: string;
  } {
    const code = opaque('mcp_code');
    this.codes.set(sha256(code), {
      code_hash: sha256(code),
      client_id: request.client.client_id,
      redirect_uri: request.redirectUri,
      code_challenge: request.codeChallenge,
      scope: request.scope,
      resource: request.resource,
      grant_id: opaque('mcp_grant'),
      expires_at: Date.now() + 10 * 60 * 1000,
    });
    this.persist();

    const url = new URL(request.redirectUri);
    url.searchParams.set('code', code);
    if (request.state !== null) url.searchParams.set('state', request.state);
    return { redirectTo: url.href };
  }

  // ===========================================================================
  // Token endpoint
  // ===========================================================================

  exchange(params: URLSearchParams): Record<string, unknown> {
    this.prune();
    const grantType = params.get('grant_type');
    if (grantType === 'authorization_code') return this.exchangeCode(params);
    if (grantType === 'refresh_token') return this.exchangeRefresh(params);
    throw new OAuthErrorResponse(
      'unsupported_grant_type',
      'use authorization_code or refresh_token',
    );
  }

  private authenticateClient(params: URLSearchParams): RegisteredClient {
    const client = this.clients.get(params.get('client_id') ?? '');
    if (!client) throw new OAuthErrorResponse('invalid_client', 'unknown client_id', 401);
    if (client.token_endpoint_auth_method === 'client_secret_post') {
      const secret = params.get('client_secret') ?? '';
      if (!secret || sha256(secret) !== client.client_secret_hash) {
        throw new OAuthErrorResponse('invalid_client', 'client authentication failed', 401);
      }
    }
    return client;
  }

  private exchangeCode(params: URLSearchParams): Record<string, unknown> {
    const client = this.authenticateClient(params);

    const code = params.get('code') ?? '';
    const record = this.codes.get(sha256(code));
    // Single-use: whatever happens next, this code is spent.
    if (record) this.codes.delete(sha256(code));

    if (!record || record.expires_at < Date.now() || record.client_id !== client.client_id) {
      throw new OAuthErrorResponse('invalid_grant', 'code is invalid or expired');
    }
    if ((params.get('redirect_uri') ?? '') !== record.redirect_uri) {
      throw new OAuthErrorResponse('invalid_grant', 'redirect_uri mismatch');
    }

    const verifier = params.get('code_verifier') ?? '';
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    if (!verifier || challenge !== record.code_challenge) {
      throw new OAuthErrorResponse('invalid_grant', 'PKCE verification failed');
    }

    const resource = params.get('resource');
    if (resource && canonicalResource(resource) !== record.resource) {
      throw new OAuthErrorResponse('invalid_target', 'resource does not match the authorized one');
    }

    return this.issueTokens(record.client_id, record.scope, record.resource, record.grant_id);
  }

  private exchangeRefresh(params: URLSearchParams): Record<string, unknown> {
    const client = this.authenticateClient(params);

    const presented = params.get('refresh_token') ?? '';
    const record = this.tokens.get(sha256(presented));
    if (!record || record.kind !== 'refresh' || record.client_id !== client.client_id) {
      throw new OAuthErrorResponse('invalid_grant', 'refresh token is invalid');
    }
    if (record.rotated || record.revoked) {
      // OAuth 2.1 refresh-token reuse detection: a rotated-away token being
      // presented again means it leaked. Kill the whole grant family.
      this.revokeGrant(record.grant_id);
      this.persist();
      throw new OAuthErrorResponse('invalid_grant', 'refresh token reuse detected; grant revoked');
    }
    if (record.expires_at < Date.now()) {
      throw new OAuthErrorResponse('invalid_grant', 'refresh token expired; re-authorize');
    }

    record.rotated = true;
    return this.issueTokens(record.client_id, record.scope, record.resource, record.grant_id);
  }

  private issueTokens(
    clientId: string,
    scope: string,
    resource: string,
    grantId: string,
  ): Record<string, unknown> {
    const accessToken = opaque('mcp_at');
    const refreshToken = opaque('mcp_rt');
    const now = Date.now();

    this.tokens.set(sha256(accessToken), {
      token_hash: sha256(accessToken),
      kind: 'access',
      client_id: clientId,
      scope,
      resource,
      grant_id: grantId,
      expires_at: now + this.options.accessTokenTtl * 1000,
      revoked: false,
      rotated: false,
    });
    this.tokens.set(sha256(refreshToken), {
      token_hash: sha256(refreshToken),
      kind: 'refresh',
      client_id: clientId,
      scope,
      resource,
      grant_id: grantId,
      expires_at: now + this.options.refreshTokenTtl * 1000,
      revoked: false,
      rotated: false,
    });
    this.persist();

    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: this.options.accessTokenTtl,
      refresh_token: refreshToken,
      scope,
    };
  }

  // ===========================================================================
  // Verification (plugs into the SDK's requireBearerAuth as OAuthTokenVerifier)
  // ===========================================================================

  async verifyAccessToken(token: string): Promise<VerifiedAccessToken> {
    const record = this.tokens.get(sha256(token));
    // The SDK's error type, not this module's: requireBearerAuth maps
    // OAuthError to a 401 challenge and anything else to a 500.
    if (!record || record.kind !== 'access' || record.revoked) {
      throw new SdkOAuthError(OAuthErrorCode.InvalidToken, 'token is not valid');
    }
    if (record.expires_at < Date.now()) {
      throw new SdkOAuthError(OAuthErrorCode.InvalidToken, 'token expired');
    }
    return {
      token,
      clientId: record.client_id,
      scopes: record.scope.split(' '),
      expiresAt: Math.floor(record.expires_at / 1000),
      resource: new URL(record.resource),
    };
  }

  private revokeGrant(grantId: string): void {
    for (const token of this.tokens.values()) {
      if (token.grant_id === grantId) token.revoked = true;
    }
  }

  // ===========================================================================
  // Persistence — OAuth artefacts only, token hashes not tokens
  // ===========================================================================

  /** Drop expired codes and tokens so the state file cannot grow unbounded. */
  private prune(): void {
    const now = Date.now();
    for (const [key, code] of this.codes) {
      if (code.expires_at < now) this.codes.delete(key);
    }
    for (const [key, token] of this.tokens) {
      // Rotated/revoked refresh records are kept until natural expiry so
      // reuse detection still fires; everything is dropped once expired.
      if (token.expires_at < now) this.tokens.delete(key);
    }
  }

  private persist(): void {
    if (!this.options.stateFile) return;
    if (this.persistTimer) return;
    // Debounced so a burst of token issuance is one write. unref() keeps the
    // timer from holding the process open.
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.writeState();
    }, 250);
    this.persistTimer.unref();
  }

  /** Flush pending state to disk immediately (shutdown hook). */
  flush(): void {
    if (!this.options.stateFile) return;
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    this.writeState();
  }

  private writeState(): void {
    this.prune();
    const state: OAuthState = {
      clients: [...this.clients.values()],
      codes: [...this.codes.values()],
      tokens: [...this.tokens.values()],
    };
    const file = this.options.stateFile;
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
    renameSync(tmp, file);
  }

  private load(): void {
    if (!this.options.stateFile) return;
    let raw: string;
    try {
      raw = readFileSync(this.options.stateFile, 'utf8');
    } catch {
      return; // First boot: no state yet.
    }
    try {
      const state = JSON.parse(raw) as OAuthState;
      for (const client of state.clients ?? []) this.clients.set(client.client_id, client);
      for (const code of state.codes ?? []) this.codes.set(code.code_hash, code);
      for (const token of state.tokens ?? []) this.tokens.set(token.token_hash, token);
      this.prune();
    } catch {
      // A corrupt state file means clients must re-register and users
      // re-authorize — annoying, recoverable, and better than refusing to
      // boot. Nothing in the file is a Coolify credential.
      console.error('oauth: state file unreadable, starting fresh');
    }
  }
}
