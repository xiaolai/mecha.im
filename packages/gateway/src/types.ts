/** A stored secret with its encrypted value. */
export interface StoredSecret {
  name: string;
  /** Base64-encoded value (upgrade to age encryption later). */
  value: string;
  createdAt: string;
  updatedAt: string;
}

/** Access grant allowing a bot to use a specific secret. */
export interface SecretGrant {
  secretName: string;
  botName: string;
  grantedAt: string;
}

/** File-backed credential store for managing secrets and access grants. */
export interface CredentialStore {
  /** Store or update a secret. */
  setSecret(name: string, value: string): void;

  /** Retrieve a decrypted secret value. Returns undefined if not found. */
  getSecret(name: string): string | undefined;

  /** List all secret names (values are never exposed). */
  listSecrets(): string[];

  /** Delete a secret and all its grants. */
  deleteSecret(name: string): boolean;

  /** Allow a bot to use a secret. */
  grantAccess(secretName: string, botName: string): void;

  /** Revoke a bot's access to a secret. */
  revokeAccess(secretName: string, botName: string): boolean;

  /** Check if a bot can use a secret. */
  checkAccess(secretName: string, botName: string): boolean;
}

/** Circuit breaker states. */
export type CircuitState = "closed" | "open" | "half-open";

/** Configuration for a circuit breaker. */
export interface CircuitBreakerOpts {
  /** Maximum consecutive failures before tripping. Default: 5. */
  maxFailures?: number;
  /** Milliseconds to wait before transitioning from open to half-open. Default: 60000. */
  resetTimeoutMs?: number;
}

/** Circuit breaker that wraps unreliable calls. */
export interface CircuitBreaker {
  /** Current state of the circuit. */
  readonly state: CircuitState;

  /** Execute a function through the circuit breaker. */
  execute<T>(fn: () => Promise<T>): Promise<T>;

  /** Reset the circuit breaker to closed state. */
  reset(): void;
}
