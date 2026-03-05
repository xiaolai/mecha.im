import { describe, it, expect } from "vitest";
import { parseTailscaleStatus } from "@mecha/core";

describe("parseTailscaleStatus", () => {
  it("extracts online peers with IPs", () => {
    const json = {
      Self: { TailscaleIPs: ["100.100.1.1"], HostName: "macbook" },
      Peer: {
        "nodekey:abc": {
          TailscaleIPs: ["100.100.1.5"],
          HostName: "spark01",
          Online: true,
          OS: "linux",
        },
        "nodekey:def": {
          TailscaleIPs: ["100.100.1.7"],
          HostName: "mac-mini",
          Online: false,
          OS: "macOS",
        },
      },
    };
    const peers = parseTailscaleStatus(json);
    expect(peers).toHaveLength(1);
    expect(peers[0]).toEqual({ ip: "100.100.1.5", hostname: "spark01" });
  });

  it("returns empty array when no peers", () => {
    const json = { Self: { TailscaleIPs: ["100.100.1.1"] }, Peer: {} };
    expect(parseTailscaleStatus(json)).toEqual([]);
  });

  it("skips peers without IPs", () => {
    const json = {
      Self: { TailscaleIPs: ["100.100.1.1"] },
      Peer: {
        "nodekey:abc": { TailscaleIPs: [], HostName: "ghost", Online: true },
      },
    };
    expect(parseTailscaleStatus(json)).toEqual([]);
  });

  it("excludes self IP", () => {
    const json = {
      Self: { TailscaleIPs: ["100.100.1.1"] },
      Peer: {
        "nodekey:abc": { TailscaleIPs: ["100.100.1.1"], HostName: "self", Online: true },
      },
    };
    expect(parseTailscaleStatus(json)).toEqual([]);
  });
});
