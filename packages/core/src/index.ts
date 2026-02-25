export type {
  CasaName,
  NodeName,
  CasaAddress,
  GroupAddress,
  Address,
} from "./types.js";
export { isCasaAddress, isGroupAddress } from "./types.js";
export { casaName, nodeName, parseAddress, formatAddress } from "./address.js";
export { NAME_PATTERN, NAME_MAX_LENGTH, isValidName, TAG_PATTERN, TAG_MAX_LENGTH, MAX_TAGS, validateTags, validateCapabilities } from "./validation.js";
export {
  MECHA_DIR,
  TOOLS_DIR,
  AUTH_DIR,
  IDENTITY_DIR,
  MANAGED_TOOLS,
  DEFAULTS,
} from "./constants.js";
export {
  MechaError,
  InvalidNameError,
  InvalidAddressError,
  CasaNotFoundError,
  CasaAlreadyExistsError,
  CasaNotRunningError,
  CasaAlreadyRunningError,
  PathNotFoundError,
  PathNotDirectoryError,
  PortConflictError,
  InvalidPortError,
  SessionNotFoundError,
  SessionBusyError,
  AuthProfileNotFoundError,
  AuthTokenExpiredError,
  AuthTokenInvalidError,
  ProcessSpawnError,
  ProcessHealthTimeoutError,
  AclDeniedError,
  IdentityNotFoundError,
  InvalidCapabilityError,
} from "./errors.js";
export {
  CasaSpawnInput,
  CasaKillInput,
  SessionCreateInput,
  SessionMessageInput,
  PermissionMode,
} from "./schemas.js";
export {
  toHttpStatus,
  toExitCode,
  toUserMessage,
  toSafeMessage,
} from "./mapping.js";
export { readCasaConfig, updateCasaConfig } from "./casa-config.js";
export type { CasaConfig } from "./casa-config.js";
export { forwardQueryToCasa } from "./forwarding.js";
export { matchesDiscoveryFilter } from "./discovery.js";
export type { DiscoverableEntry, DiscoveryFilter } from "./discovery.js";

// Identity (Phase 3)
export {
  generateKeyPair,
  fingerprint,
  loadPrivateKey,
  createNodeIdentity,
  loadNodeIdentity,
  loadNodePrivateKey,
  createCasaIdentity,
  loadCasaIdentity,
  loadCasaIdentityFromDir,
  signMessage,
  verifySignature,
} from "./identity/index.js";
export type { KeyPair, NodeIdentity, CasaIdentity } from "./identity/index.js";

// ACL (Phase 3)
export {
  ALL_CAPABILITIES,
  isCapability,
  createAclEngine,
  loadAcl,
  saveAcl,
} from "./acl/index.js";
export type {
  Capability,
  AclRule,
  AclResult,
  AclEngine,
  CreateAclEngineOpts,
  AclData,
} from "./acl/index.js";
