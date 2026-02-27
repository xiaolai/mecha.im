import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NodeName } from "@mecha/core";
import type { WebSocketLike } from "../src/relay.js";
import type {
  SecureChannel,
  RendezvousClient,
  PeerInfo,
  SignalData,
  Candidate,
} from "../src/types.js";

// --- Module mocks ---

vi.mock("../src/rendezvous.js", () => ({
  createRendezvousClient: vi.fn(),
}));

vi.mock("../src/invite.js", () => ({
  createInviteCode: vi.fn().mockResolvedValue({ code: "mecha://invite/abc", token: "t", expiresAt: "2099-01-01" }),
  parseInviteCode: vi.fn().mockReturnValue({
    inviterName: "alice",
    inviterPublicKey: "pk",
    inviterNoisePublicKey: "npk",
    inviterFingerprint: "fp",
    rendezvousUrl: "wss://rv.test",
    token: "t",
    expiresAt: "2099-01-01",
    signature: "sig",
  }),
}));

vi.mock("../src/stun.js", () => ({
  stunDiscover: vi.fn(),
  buildBindingRequest: vi.fn(),
  parseBindingResponse: vi.fn(),
  parseStunServer: vi.fn(),
}));

vi.mock("../src/hole-punch.js", () => ({
  holePunch: vi.fn(),
}));

vi.mock("../src/noise.js", () => ({
  noiseInitiate: vi.fn(),
  noiseRespond: vi.fn(),
  createNoiseCipher: vi.fn(),
}));

vi.mock("../src/relay.js", () => ({
  relayConnect: vi.fn(),
}));

vi.mock("../src/channel.js", () => ({
  createSecureChannel: vi.fn(),
}));

vi.mock("@mecha/core", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    signMessage: vi.fn(() => "mock-sig"),
    addNode: vi.fn(),
    getNode: vi.fn(),
  };
});

import { createConnectManager } from "../src/connect-manager.js";
import { createRendezvousClient } from "../src/rendezvous.js";
import { stunDiscover } from "../src/stun.js";
import { holePunch } from "../src/hole-punch.js";
import { noiseInitiate } from "../src/noise.js";
import { relayConnect } from "../src/relay.js";
import { createSecureChannel } from "../src/channel.js";
import { getNode, addNode } from "@mecha/core";

// --- Helpers ---

function makeMockRendezvous(): RendezvousClient & {
  _signalHandlers: Array<(from: NodeName, data: SignalData) => void>;
  _inviteAcceptedHandlers: Array<(peer: string, pk: string, npk: string, fp: string) => void>;
} {
  const signalHandlers: Array<(from: NodeName, data: SignalData) => void> = [];
  const inviteAcceptedHandlers: Array<(peer: string, pk: string, npk: string, fp: string) => void> = [];

  return {
    connect: vi.fn().mockResolvedValue(undefined),
    register: vi.fn().mockResolvedValue(undefined),
    unregister: vi.fn().mockResolvedValue(undefined),
    lookup: vi.fn(),
    signal: vi.fn().mockResolvedValue(undefined),
    requestRelay: vi.fn().mockResolvedValue("relay-token"),
    onSignal(handler) { signalHandlers.push(handler); },
    onInviteAccepted(handler) { inviteAcceptedHandlers.push(handler); },
    close: vi.fn(),
    _signalHandlers: signalHandlers,
    _inviteAcceptedHandlers: inviteAcceptedHandlers,
  };
}

function makeMockChannel(peer: string, open = true): SecureChannel & {
  _closeHandlers: Array<(reason: string) => void>;
  _open: boolean;
} {
  const closeHandlers: Array<(reason: string) => void> = [];
  const ch = {
    peer: peer as NodeName,
    type: "relayed" as const,
    latencyMs: 5,
    peerFingerprint: "fp-" + peer,
    send: vi.fn(),
    onMessage: vi.fn(),
    offMessage: vi.fn(),
    onClose(handler: (reason: string) => void) { closeHandlers.push(handler); },
    onError: vi.fn(),
    close: vi.fn(() => { ch._open = false; }),
    get isOpen() { return ch._open; },
    _closeHandlers: closeHandlers,
    _open: open,
  };
  return ch;
}

const IDENTITY = {
  id: "node-a",
  publicKey: "pub-a",
  fingerprint: "fp-a",
};

const NOISE_KEY_PAIR = {
  publicKey: "noise-pub-a",
  privateKey: "noise-priv-a",
};

function makeOpts(overrides?: Partial<Parameters<typeof createConnectManager>[0]>) {
  return {
    identity: IDENTITY,
    nodeName: "node-a",
    privateKey: "priv-a",
    noiseKeyPair: NOISE_KEY_PAIR,
    mechaDir: "/tmp/test-mecha",
    rendezvousUrl: "wss://rv.test",
    relayUrl: "wss://relay.test",
    answerTimeoutMs: 500,
    ...overrides,
  };
}

const PEER = "bob" as NodeName;
const PEER_INFO: PeerInfo = {
  name: "bob",
  publicKey: "pub-bob",
  noisePublicKey: "npub-bob",
  fingerprint: "fp-bob",
  online: true,
  sameLan: false,
};

describe("ConnectManager", () => {
  let mockRv: ReturnType<typeof makeMockRendezvous>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRv = makeMockRendezvous();
    vi.mocked(createRendezvousClient).mockReturnValue(mockRv);
  });

  describe("start()", () => {
    it("creates rendezvous client and registers", async () => {
      const mgr = createConnectManager(makeOpts());
      await mgr.start();

      expect(createRendezvousClient).toHaveBeenCalled();
      expect(mockRv.connect).toHaveBeenCalled();
      expect(mockRv.register).toHaveBeenCalledWith({
        name: "node-a",
        publicKey: "pub-a",
        noisePublicKey: "noise-pub-a",
        fingerprint: "fp-a",
      });
    });

    it("is idempotent", async () => {
      const mgr = createConnectManager(makeOpts());
      await mgr.start();
      await mgr.start();

      expect(mockRv.connect).toHaveBeenCalledTimes(1);
    });
  });

  describe("connect()", () => {
    it("throws if not started", async () => {
      const mgr = createConnectManager(makeOpts());
      await expect(mgr.connect(PEER)).rejects.toThrow("ConnectManager not started");
    });

    it("returns cached channel if open", async () => {
      const mgr = createConnectManager(makeOpts());
      await mgr.start();

      // First connect: set up mocks for relay path
      mockRv.lookup.mockResolvedValue(PEER_INFO);
      vi.mocked(stunDiscover).mockRejectedValue(new Error("STUN fail"));
      const mockCh = makeMockChannel("bob");
      vi.mocked(relayConnect).mockResolvedValue({
        send: vi.fn(),
        onMessage: vi.fn(),
        onClose: vi.fn(),
        close: vi.fn(),
      });
      vi.mocked(noiseInitiate).mockResolvedValue({
        cipher: { encrypt: vi.fn(), decrypt: vi.fn(), rekey: vi.fn() },
        remoteStaticKey: new Uint8Array(32),
      });
      vi.mocked(createSecureChannel).mockReturnValue(mockCh);
      vi.mocked(getNode).mockReturnValue({
        name: "bob", host: "", port: 0, apiKey: "", publicKey: "pk",
        noisePublicKey: "npk", fingerprint: "fp-bob", addedAt: "", managed: true,
      });

      const ch1 = await mgr.connect(PEER);
      const ch2 = await mgr.connect(PEER);
      expect(ch1).toBe(ch2);
      // Only one actual connect attempt
      expect(mockRv.lookup).toHaveBeenCalledTimes(1);
    });

    it("throws PeerOfflineError when peer is offline", async () => {
      const mgr = createConnectManager(makeOpts());
      await mgr.start();

      mockRv.lookup.mockResolvedValue({ ...PEER_INFO, online: false });
      await expect(mgr.connect(PEER)).rejects.toThrow(/offline/i);
    });

    it("throws PeerOfflineError when peer not found", async () => {
      const mgr = createConnectManager(makeOpts());
      await mgr.start();

      mockRv.lookup.mockResolvedValue(undefined);
      await expect(mgr.connect(PEER)).rejects.toThrow(/offline/i);
    });

    it("connects via relay when STUN fails", async () => {
      const mgr = createConnectManager(makeOpts());
      await mgr.start();

      mockRv.lookup.mockResolvedValue(PEER_INFO);
      vi.mocked(stunDiscover).mockRejectedValue(new Error("STUN fail"));
      vi.mocked(getNode).mockReturnValue({
        name: "bob", host: "", port: 0, apiKey: "", publicKey: "pk",
        noisePublicKey: "npk", fingerprint: "fp-bob", addedAt: "", managed: true,
      });

      const mockRelay = {
        send: vi.fn(), onMessage: vi.fn(), onClose: vi.fn(), close: vi.fn(),
      };
      vi.mocked(relayConnect).mockResolvedValue(mockRelay);
      vi.mocked(noiseInitiate).mockResolvedValue({
        cipher: { encrypt: vi.fn(), decrypt: vi.fn(), rekey: vi.fn() },
        remoteStaticKey: new Uint8Array(32),
      });
      const mockCh = makeMockChannel("bob");
      vi.mocked(createSecureChannel).mockReturnValue(mockCh);

      const ch = await mgr.connect(PEER);
      expect(ch).toBe(mockCh);
      expect(relayConnect).toHaveBeenCalled();
      expect(noiseInitiate).toHaveBeenCalled();
    });

    it("deduplicates concurrent connect() calls", async () => {
      const mgr = createConnectManager(makeOpts());
      await mgr.start();

      mockRv.lookup.mockResolvedValue(PEER_INFO);
      vi.mocked(stunDiscover).mockRejectedValue(new Error("STUN fail"));
      vi.mocked(getNode).mockReturnValue({
        name: "bob", host: "", port: 0, apiKey: "", publicKey: "pk",
        noisePublicKey: "npk", fingerprint: "fp-bob", addedAt: "", managed: true,
      });
      vi.mocked(relayConnect).mockResolvedValue({
        send: vi.fn(), onMessage: vi.fn(), onClose: vi.fn(), close: vi.fn(),
      });
      vi.mocked(noiseInitiate).mockResolvedValue({
        cipher: { encrypt: vi.fn(), decrypt: vi.fn(), rekey: vi.fn() },
        remoteStaticKey: new Uint8Array(32),
      });
      const mockCh = makeMockChannel("bob");
      vi.mocked(createSecureChannel).mockReturnValue(mockCh);

      const [ch1, ch2] = await Promise.all([
        mgr.connect(PEER),
        mgr.connect(PEER),
      ]);

      expect(ch1).toBe(ch2);
      // Only one lookup despite two concurrent calls
      expect(mockRv.lookup).toHaveBeenCalledTimes(1);
    });

    it("evicts cached channel on close", async () => {
      const mgr = createConnectManager(makeOpts());
      await mgr.start();

      mockRv.lookup.mockResolvedValue(PEER_INFO);
      vi.mocked(stunDiscover).mockRejectedValue(new Error("STUN fail"));
      vi.mocked(getNode).mockReturnValue({
        name: "bob", host: "", port: 0, apiKey: "", publicKey: "pk",
        noisePublicKey: "npk", fingerprint: "fp-bob", addedAt: "", managed: true,
      });
      vi.mocked(relayConnect).mockResolvedValue({
        send: vi.fn(), onMessage: vi.fn(), onClose: vi.fn(), close: vi.fn(),
      });
      vi.mocked(noiseInitiate).mockResolvedValue({
        cipher: { encrypt: vi.fn(), decrypt: vi.fn(), rekey: vi.fn() },
        remoteStaticKey: new Uint8Array(32),
      });

      const mockCh1 = makeMockChannel("bob");
      const mockCh2 = makeMockChannel("bob");
      vi.mocked(createSecureChannel)
        .mockReturnValueOnce(mockCh1)
        .mockReturnValueOnce(mockCh2);

      const ch1 = await mgr.connect(PEER);
      expect(ch1).toBe(mockCh1);

      // Simulate channel close
      mockCh1._open = false;
      for (const h of mockCh1._closeHandlers) h("peer disconnected");

      // Next connect should create a new channel
      const ch2 = await mgr.connect(PEER);
      expect(ch2).toBe(mockCh2);
      expect(mockRv.lookup).toHaveBeenCalledTimes(2);
    });

    it("falls back to relay when STUN succeeds but answer times out", async () => {
      const mgr = createConnectManager(makeOpts({ answerTimeoutMs: 50 }));
      await mgr.start();

      mockRv.lookup.mockResolvedValue(PEER_INFO);
      vi.mocked(stunDiscover).mockResolvedValue({ ip: "1.2.3.4", port: 5000 });
      vi.mocked(getNode).mockReturnValue({
        name: "bob", host: "", port: 0, apiKey: "", publicKey: "pk",
        noisePublicKey: "npk", fingerprint: "fp-bob", addedAt: "", managed: true,
      });
      vi.mocked(relayConnect).mockResolvedValue({
        send: vi.fn(), onMessage: vi.fn(), onClose: vi.fn(), close: vi.fn(),
      });
      vi.mocked(noiseInitiate).mockResolvedValue({
        cipher: { encrypt: vi.fn(), decrypt: vi.fn(), rekey: vi.fn() },
        remoteStaticKey: new Uint8Array(32),
      });
      const mockCh = makeMockChannel("bob");
      vi.mocked(createSecureChannel).mockReturnValue(mockCh);

      // No answer signal arrives → timeout → relay fallback
      const ch = await mgr.connect(PEER);
      expect(ch).toBe(mockCh);
      // Should have sent offer signal
      expect(mockRv.signal).toHaveBeenCalledWith(PEER, expect.objectContaining({ type: "offer" }));
      // Falls back to relay
      expect(relayConnect).toHaveBeenCalled();
    });
  });

  describe("inbound offer handling", () => {
    it("resolves pending answer when answer signal arrives", async () => {
      const mgr = createConnectManager(makeOpts());
      await mgr.start();

      mockRv.lookup.mockResolvedValue(PEER_INFO);
      vi.mocked(stunDiscover).mockResolvedValue({ ip: "1.2.3.4", port: 5000 });
      vi.mocked(getNode).mockReturnValue({
        name: "bob", host: "", port: 0, apiKey: "", publicKey: "pk",
        noisePublicKey: "npk", fingerprint: "fp-bob", addedAt: "", managed: true,
      });
      const mockRelay = {
        send: vi.fn(), onMessage: vi.fn(), onClose: vi.fn(), close: vi.fn(),
      };
      vi.mocked(relayConnect).mockResolvedValue(mockRelay);
      vi.mocked(noiseInitiate).mockResolvedValue({
        cipher: { encrypt: vi.fn(), decrypt: vi.fn(), rekey: vi.fn() },
        remoteStaticKey: new Uint8Array(32),
      });
      vi.mocked(holePunch).mockResolvedValue({ success: false });
      const mockCh = makeMockChannel("bob");
      vi.mocked(createSecureChannel).mockReturnValue(mockCh);

      // Start connecting (sends offer, waits for answer)
      const connectPromise = mgr.connect(PEER);

      // Simulate answer signal arriving via rendezvous
      await vi.waitFor(() => {
        expect(mockRv.signal).toHaveBeenCalledWith(PEER, expect.objectContaining({ type: "offer" }));
      });

      const answerCandidates: Candidate[] = [{ ip: "5.6.7.8", port: 6000, source: "stun" }];
      for (const h of mockRv._signalHandlers) {
        h(PEER, { type: "answer", candidates: answerCandidates });
      }

      const ch = await connectPromise;
      expect(ch).toBe(mockCh);
      // holePunch was called with the remote candidates
      expect(holePunch).toHaveBeenCalledWith(expect.objectContaining({
        remoteCandidates: answerCandidates,
      }));
    });
  });

  describe("onConnection()", () => {
    it("fires handler when inbound offer creates channel", async () => {
      const mgr = createConnectManager(makeOpts());
      await mgr.start();

      const inboundChannels: SecureChannel[] = [];
      mgr.onConnection((ch) => inboundChannels.push(ch));

      // Set up mocks for inbound path
      vi.mocked(getNode).mockReturnValue({
        name: "charlie", host: "", port: 0, apiKey: "", publicKey: "pk",
        noisePublicKey: "npk", fingerprint: "fp-charlie", addedAt: "", managed: true,
      });
      vi.mocked(relayConnect).mockResolvedValue({
        send: vi.fn(), onMessage: vi.fn(), onClose: vi.fn(), close: vi.fn(),
      });
      const { noiseRespond } = await import("../src/noise.js");
      vi.mocked(noiseRespond).mockResolvedValue({
        cipher: { encrypt: vi.fn(), decrypt: vi.fn(), rekey: vi.fn() },
        remoteStaticKey: new Uint8Array(32),
      });
      const mockCh = makeMockChannel("charlie");
      vi.mocked(createSecureChannel).mockReturnValue(mockCh);

      // Simulate inbound offer from "charlie"
      const offerCandidates: Candidate[] = [{ ip: "9.8.7.6", port: 7000, source: "stun" }];
      for (const h of mockRv._signalHandlers) {
        h("charlie" as NodeName, { type: "offer", candidates: offerCandidates });
      }

      // Wait for async handler to complete
      await vi.waitFor(() => {
        expect(inboundChannels).toHaveLength(1);
      });

      expect(inboundChannels[0]).toBe(mockCh);
      // Responder sends answer signal
      expect(mockRv.signal).toHaveBeenCalledWith("charlie", expect.objectContaining({ type: "answer" }));
    });
  });

  describe("close()", () => {
    it("closes all channels and rendezvous", async () => {
      const mgr = createConnectManager(makeOpts());
      await mgr.start();

      // Connect to get a cached channel
      mockRv.lookup.mockResolvedValue(PEER_INFO);
      vi.mocked(stunDiscover).mockRejectedValue(new Error("STUN fail"));
      vi.mocked(getNode).mockReturnValue({
        name: "bob", host: "", port: 0, apiKey: "", publicKey: "pk",
        noisePublicKey: "npk", fingerprint: "fp-bob", addedAt: "", managed: true,
      });
      vi.mocked(relayConnect).mockResolvedValue({
        send: vi.fn(), onMessage: vi.fn(), onClose: vi.fn(), close: vi.fn(),
      });
      vi.mocked(noiseInitiate).mockResolvedValue({
        cipher: { encrypt: vi.fn(), decrypt: vi.fn(), rekey: vi.fn() },
        remoteStaticKey: new Uint8Array(32),
      });
      const mockCh = makeMockChannel("bob");
      vi.mocked(createSecureChannel).mockReturnValue(mockCh);

      await mgr.connect(PEER);
      await mgr.close();

      expect(mockCh.close).toHaveBeenCalled();
      expect(mockRv.unregister).toHaveBeenCalled();
      expect(mockRv.close).toHaveBeenCalled();
    });

    it("is safe to call without start", async () => {
      const mgr = createConnectManager(makeOpts());
      await mgr.close(); // Should not throw
    });
  });

  describe("createInvite()", () => {
    it("throws if not started", async () => {
      const mgr = createConnectManager(makeOpts());
      await expect(mgr.createInvite()).rejects.toThrow("ConnectManager not started");
    });

    it("delegates to createInviteCode when started", async () => {
      const mgr = createConnectManager(makeOpts());
      await mgr.start();

      const result = await mgr.createInvite({ expiresIn: 3600 });
      expect(result.code).toBe("mecha://invite/abc");
    });
  });

  describe("acceptInvite()", () => {
    it("throws if not started", async () => {
      const mgr = createConnectManager(makeOpts());
      await expect(mgr.acceptInvite("mecha://invite/abc")).rejects.toThrow("ConnectManager not started");
    });

    it("adds peer node and returns result when started", async () => {
      const mgr = createConnectManager(makeOpts());
      await mgr.start();

      const result = await mgr.acceptInvite("mecha://invite/abc");
      expect(result.peer).toBe("alice");
      expect(addNode).toHaveBeenCalledWith(
        "/tmp/test-mecha",
        expect.objectContaining({ name: "alice", managed: true }),
      );
    });
  });

  describe("ping()", () => {
    it("throws PeerOfflineError if no open channel", async () => {
      const mgr = createConnectManager(makeOpts());
      await expect(mgr.ping(PEER)).rejects.toThrow(/offline/i);
    });

    it("uses computed latency when channel latencyMs is 0", async () => {
      const mgr = createConnectManager(makeOpts());
      await mgr.start();

      mockRv.lookup.mockResolvedValue(PEER_INFO);
      vi.mocked(stunDiscover).mockRejectedValue(new Error("STUN fail"));
      vi.mocked(getNode).mockReturnValue({
        name: "bob", host: "", port: 0, apiKey: "", publicKey: "pk",
        noisePublicKey: "npk", fingerprint: "fp-bob", addedAt: "", managed: true,
      });
      vi.mocked(relayConnect).mockResolvedValue({
        send: vi.fn(), onMessage: vi.fn(), onClose: vi.fn(), close: vi.fn(),
      });
      vi.mocked(noiseInitiate).mockResolvedValue({
        cipher: { encrypt: vi.fn(), decrypt: vi.fn(), rekey: vi.fn() },
        remoteStaticKey: new Uint8Array(32),
      });
      const mockCh = makeMockChannel("bob");
      mockCh.latencyMs = 0; // Falsy, so fallback path runs
      vi.mocked(createSecureChannel).mockReturnValue(mockCh);

      await mgr.connect(PEER);
      const result = await mgr.ping(PEER);
      expect(result.peer).toBe(PEER);
      expect(typeof result.latencyMs).toBe("number");
    });

    it("sends ping and returns latency when channel exists", async () => {
      const mgr = createConnectManager(makeOpts());
      await mgr.start();

      // Connect to create a cached channel
      mockRv.lookup.mockResolvedValue(PEER_INFO);
      vi.mocked(stunDiscover).mockRejectedValue(new Error("STUN fail"));
      vi.mocked(getNode).mockReturnValue({
        name: "bob", host: "", port: 0, apiKey: "", publicKey: "pk",
        noisePublicKey: "npk", fingerprint: "fp-bob", addedAt: "", managed: true,
      });
      vi.mocked(relayConnect).mockResolvedValue({
        send: vi.fn(), onMessage: vi.fn(), onClose: vi.fn(), close: vi.fn(),
      });
      vi.mocked(noiseInitiate).mockResolvedValue({
        cipher: { encrypt: vi.fn(), decrypt: vi.fn(), rekey: vi.fn() },
        remoteStaticKey: new Uint8Array(32),
      });
      const mockCh = makeMockChannel("bob");
      vi.mocked(createSecureChannel).mockReturnValue(mockCh);

      await mgr.connect(PEER);

      const result = await mgr.ping(PEER);
      expect(result.peer).toBe(PEER);
      expect(result.connectionType).toBe("relayed");
      expect(result.latencyMs).toBe(5); // mockCh.latencyMs = 5
      expect(mockCh.send).toHaveBeenCalled();
    });
  });

  describe("hole-punch success path", () => {
    it("returns hole-punched channel when punch succeeds", async () => {
      const mgr = createConnectManager(makeOpts());
      await mgr.start();

      mockRv.lookup.mockResolvedValue(PEER_INFO);
      vi.mocked(stunDiscover).mockResolvedValue({ ip: "1.2.3.4", port: 5000 });
      vi.mocked(getNode).mockReturnValue({
        name: "bob", host: "", port: 0, apiKey: "", publicKey: "pk",
        noisePublicKey: "npk", fingerprint: "fp-bob", addedAt: "", managed: true,
      });
      vi.mocked(holePunch).mockResolvedValue({
        success: true,
        remoteAddress: "5.6.7.8",
        remotePort: 6000,
        candidateIndex: 0,
      });
      vi.mocked(relayConnect).mockResolvedValue({
        send: vi.fn(), onMessage: vi.fn(), onClose: vi.fn(), close: vi.fn(),
      });
      vi.mocked(noiseInitiate).mockResolvedValue({
        cipher: { encrypt: vi.fn(), decrypt: vi.fn(), rekey: vi.fn() },
        remoteStaticKey: new Uint8Array(32),
      });
      const mockCh = makeMockChannel("bob");
      vi.mocked(createSecureChannel).mockReturnValue(mockCh);

      // Start connecting
      const connectPromise = mgr.connect(PEER);

      // Wait for offer to be sent, then send answer
      await vi.waitFor(() => {
        expect(mockRv.signal).toHaveBeenCalledWith(PEER, expect.objectContaining({ type: "offer" }));
      });

      const answerCandidates: Candidate[] = [{ ip: "5.6.7.8", port: 6000, source: "stun" }];
      for (const h of mockRv._signalHandlers) {
        h(PEER, { type: "answer", candidates: answerCandidates });
      }

      const ch = await connectPromise;
      expect(ch).toBeDefined();
      // Hole punch was called and succeeded
      expect(holePunch).toHaveBeenCalledWith(expect.objectContaining({
        remoteCandidates: answerCandidates,
      }));
    });
  });

  describe("signal routing", () => {
    it("ignores answer signals that have no pending connect", async () => {
      const mgr = createConnectManager(makeOpts());
      await mgr.start();

      // Send answer without any pending connect — should not throw
      for (const h of mockRv._signalHandlers) {
        h(PEER, { type: "answer", candidates: [] });
      }
    });

    it("ignores relay-ready signals (neither offer nor answer)", async () => {
      const mgr = createConnectManager(makeOpts());
      await mgr.start();

      // Send a relay-ready signal — should be silently ignored
      for (const h of mockRv._signalHandlers) {
        h(PEER, { type: "relay-ready", token: "tok" });
      }
    });
  });

  describe("getChannel()", () => {
    it("returns channel when it exists and is open", async () => {
      const mgr = createConnectManager(makeOpts());
      await mgr.start();

      mockRv.lookup.mockResolvedValue(PEER_INFO);
      vi.mocked(stunDiscover).mockRejectedValue(new Error("STUN fail"));
      vi.mocked(getNode).mockReturnValue({
        name: "bob", host: "", port: 0, apiKey: "", publicKey: "pk",
        noisePublicKey: "npk", fingerprint: "fp-bob", addedAt: "", managed: true,
      });
      vi.mocked(relayConnect).mockResolvedValue({
        send: vi.fn(), onMessage: vi.fn(), onClose: vi.fn(), close: vi.fn(),
      });
      vi.mocked(noiseInitiate).mockResolvedValue({
        cipher: { encrypt: vi.fn(), decrypt: vi.fn(), rekey: vi.fn() },
        remoteStaticKey: new Uint8Array(32),
      });
      const mockCh = makeMockChannel("bob");
      vi.mocked(createSecureChannel).mockReturnValue(mockCh);

      await mgr.connect(PEER);
      expect(mgr.getChannel(PEER)).toBe(mockCh);

      // Closed channel returns undefined
      mockCh._open = false;
      expect(mgr.getChannel(PEER)).toBeUndefined();
    });
  });

  describe("close with pending answers", () => {
    it("rejects pending answers on close", async () => {
      const mgr = createConnectManager(makeOpts({ answerTimeoutMs: 60_000 }));
      await mgr.start();

      mockRv.lookup.mockResolvedValue(PEER_INFO);
      vi.mocked(stunDiscover).mockResolvedValue({ ip: "1.2.3.4", port: 5000 });
      vi.mocked(getNode).mockReturnValue({
        name: "bob", host: "", port: 0, apiKey: "", publicKey: "pk",
        noisePublicKey: "npk", fingerprint: "fp-bob", addedAt: "", managed: true,
      });
      // Make relay fail too so connect doesn't succeed via fallback
      mockRv.requestRelay.mockRejectedValue(new Error("closed"));

      // Start a connect that will wait for answer
      const connectPromise = mgr.connect(PEER);

      // Wait for offer to be sent
      await vi.waitFor(() => {
        expect(mockRv.signal).toHaveBeenCalledWith(PEER, expect.objectContaining({ type: "offer" }));
      });

      // Close while waiting for answer
      await mgr.close();

      // Connect should reject
      await expect(connectPromise).rejects.toThrow();
    });
  });

  describe("invite accepted handler", () => {
    it("adds node on invite-accepted event from rendezvous", async () => {
      const mgr = createConnectManager(makeOpts());
      vi.mocked(getNode).mockReturnValue(undefined as never);
      await mgr.start();

      for (const h of mockRv._inviteAcceptedHandlers) {
        h("dave", "dave-pk", "dave-npk", "dave-fp");
      }

      expect(addNode).toHaveBeenCalledWith(
        "/tmp/test-mecha",
        expect.objectContaining({ name: "dave", publicKey: "dave-pk", managed: true }),
      );
    });
  });
});
