import { describe, it, expect } from "vitest";
import { isPrivateHost, validateRemoteHost } from "../src/host-validation.js";

describe("isPrivateHost", () => {
  it("detects localhost", () => {
    expect(isPrivateHost("localhost")).toBe(true);
  });

  it("detects loopback IPv4", () => {
    expect(isPrivateHost("127.0.0.1")).toBe(true);
    expect(isPrivateHost("127.255.255.255")).toBe(true);
  });

  it("detects private IPv4 ranges", () => {
    expect(isPrivateHost("10.0.0.1")).toBe(true);
    expect(isPrivateHost("172.16.0.1")).toBe(true);
    expect(isPrivateHost("172.31.255.255")).toBe(true);
    expect(isPrivateHost("192.168.1.1")).toBe(true);
  });

  it("detects link-local IPv4", () => {
    expect(isPrivateHost("169.254.1.1")).toBe(true);
  });

  it("detects 0.0.0.0/8", () => {
    expect(isPrivateHost("0.0.0.0")).toBe(true);
  });

  it("allows public IPv4", () => {
    expect(isPrivateHost("8.8.8.8")).toBe(false);
    expect(isPrivateHost("203.0.113.1")).toBe(false);
  });

  it("detects IPv6 loopback", () => {
    expect(isPrivateHost("::1")).toBe(true);
  });

  it("detects IPv6 link-local", () => {
    expect(isPrivateHost("fe80::1")).toBe(true);
  });

  it("detects IPv6 unique local", () => {
    expect(isPrivateHost("fc00::1")).toBe(true);
    expect(isPrivateHost("fd12::1")).toBe(true);
  });

  it("allows public hostnames", () => {
    expect(isPrivateHost("example.com")).toBe(false);
    expect(isPrivateHost("my-node.local")).toBe(false);
  });
});

describe("validateRemoteHost", () => {
  it("throws for private hosts", () => {
    expect(() => validateRemoteHost("127.0.0.1")).toThrow("private/loopback");
    expect(() => validateRemoteHost("localhost")).toThrow("private/loopback");
    expect(() => validateRemoteHost("192.168.1.1")).toThrow("private/loopback");
  });

  it("allows public hosts", () => {
    expect(() => validateRemoteHost("203.0.113.1")).not.toThrow();
    expect(() => validateRemoteHost("example.com")).not.toThrow();
  });
});
