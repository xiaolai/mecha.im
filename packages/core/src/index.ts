export { createLogger, resetLogLevel } from "./logger.js";
export type { Logger } from "./logger.js";
export { safeReadJson } from "./safe-read.js";
export { isPidAlive } from "./pid.js";
export { safeCompare } from "./safe-compare.js";
export type { SafeReadResult } from "./safe-read.js";
export type {
  BotName,
  NodeName,
  BotAddress,
  GroupAddress,
  Address,
} from "./types.js";
export { isBotAddress, isGroupAddress } from "./types.js";
export { botName, nodeName, parseAddress, formatAddress } from "./address.js";
export { NAME_PATTERN, NAME_MAX_LENGTH, isValidName, isValidAddress, TAG_PATTERN, TAG_MAX_LENGTH, MAX_TAGS, validateTags, validateCapabilities, parsePort } from "./validation.js";
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
  BotNotFoundError,
  BotAlreadyExistsError,
  BotNotRunningError,
  BotAlreadyRunningError,
  BotBusyError,
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
  NodeNotFoundError,
  DuplicateNodeError,
  AuthProfileAlreadyExistsError,
  ForwardingError,
  InvalidToolNameError,
  SessionFetchError,
  ChatRequestError,
  RemoteRoutingError,
  CorruptConfigError,
  PortRangeExhaustedError,
  GroupAddressNotSupportedError,
  ScheduleNotFoundError,
  DuplicateScheduleError,
  InvalidIntervalError,
  CliAlreadyRunningError,
  MeterProxyAlreadyRunningError,
  MeterProxyNotRunningError,
  MeterProxyRequiredError,
  ConnectError,
  InvalidInviteError,
  HandshakeError,
  PeerOfflineError,
  RendezvousError,
} from "./errors.js";
export {
  BotSpawnInput,
  BotKillInput,
  SessionCreateInput,
  SessionMessageInput,
  PermissionMode,
} from "./schemas.js";
export {
  toUserMessage,
  toSafeMessage,
} from "./mapping.js";
export { readBotConfig, updateBotConfig, BOT_CONFIG_VERSION } from "./bot-config.js";
export type { BotConfig, SandboxMode } from "./bot-config.js";
export { forwardQueryToBot } from "./forwarding.js";
export type { ForwardResult } from "./forwarding.js";
export { matchesDiscoveryFilter } from "./discovery.js";
export type { DiscoverableEntry, DiscoveryFilter, DiscoveryIndex, DiscoveryIndexEntry } from "./discovery.js";

// Identity (Phase 3)
export {
  generateKeyPair,
  fingerprint,
  loadPrivateKey,
  createNodeIdentity,
  loadNodeIdentity,
  loadNodePrivateKey,
  createBotIdentity,
  loadBotIdentity,
  loadBotIdentityFromDir,
  signMessage,
  verifySignature,
  generateNoiseKeyPair,
  createNoiseKeys,
  loadNoiseKeyPair,
  loadNoisePublicKey,
} from "./identity/index.js";
export type { KeyPair, NodeIdentity, BotIdentity, NoiseKeyPairCore } from "./identity/index.js";

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

// Node Registry (Phase 4)
export { readNodes, writeNodes, addNode, removeNode, getNode } from "./node-registry.js";
export type { NodeEntry } from "./node-registry.js";

// Server State (Phase 6b)
export { readServerState, writeServerState, removeServerState } from "./server-state.js";
export type { ServerState } from "./server-state.js";

// Host validation
export { isPrivateHost, validateRemoteHost } from "./host-validation.js";

// Auth Resolution
export {
  resolveAuth,
  readAuthProfiles,
  readAuthCredentials,
  authEnvVar,
  listAuthProfiles,
  getDefaultProfileName,
  isValidProfileName,
} from "./auth-resolve.js";
export type {
  AuthProfileMeta,
  AuthProfileStore,
  AuthCredentialStore,
  ResolvedAuth,
} from "./auth-resolve.js";

// Plugin Registry
export {
  PLUGIN_REGISTRY_VERSION,
  RESERVED_PLUGIN_NAMES,
  pluginName,
  StdioPluginInputSchema,
  HttpPluginInputSchema,
  PluginInputSchema,
  PluginNameReservedError,
  PluginNotFoundError,
  PluginAlreadyExistsError,
  PluginEnvError,
  readPluginRegistry,
  writePluginRegistry,
  addPlugin,
  removePlugin,
  getPlugin,
  listPlugins,
  isPluginName,
} from "./plugin-registry.js";
export type {
  PluginName,
  PluginConfigBase,
  StdioPluginConfig,
  HttpPluginConfig,
  PluginConfig,
  PluginRegistry,
} from "./plugin-registry.js";
export { resolveEnvVars, resolveEnvString } from "./plugin-resolve.js";

// TOTP Storage
export {
  readTotpSecret,
  writeTotpSecret,
  generateTotpSecret,
  ensureTotpSecret,
} from "./totp-storage.js";

// Auth Config
export {
  readAuthConfig,
  writeAuthConfig,
  resolveAuthConfig,
} from "./auth-config.js";
export type { AuthConfig, AuthConfigOverrides } from "./auth-config.js";

// Node Info
export { getNetworkIps, fetchPublicIp, collectNodeInfo, formatUptime } from "./node-info.js";
export type { NodeInfo } from "./node-info.js";

// Schedule Engine
export {
  parseInterval,
  ScheduleEntrySchema,
  ScheduleRunResultSchema,
  ScheduleConfigSchema,
  ScheduleStateSchema,
  ScheduleAddInput,
  SCHEDULE_DEFAULTS,
} from "./schedule.js";
export type {
  ScheduleEntry,
  ScheduleRunResult,
  ScheduleConfig,
  ScheduleState,
} from "./schedule.js";
