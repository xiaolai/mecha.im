import { describe, it, expect } from "vitest";
import { buildBindingRequest, parseBindingResponse, parseStunServer } from "../src/stun.js";

describe("stun", () => {
  describe("buildBindingRequest", () => {
    it("builds a 20-byte STUN binding request", () => {
      const { buffer, transactionId } = buildBindingRequest();
      expect(buffer.length).toBe(20);
      expect(transactionId.length).toBe(12);
      // Message type: 0x0001 (Binding Request)
      expect(buffer.readUInt16BE(0)).toBe(0x0001);
      // Message length: 0 (no attributes)
      expect(buffer.readUInt16BE(2)).toBe(0);
      // Magic cookie: 0x2112a442
      expect(buffer.readUInt32BE(4)).toBe(0x2112a442);
      // Transaction ID matches
      expect(buffer.subarray(8, 20).equals(transactionId)).toBe(true);
    });

    it("generates unique transaction IDs", () => {
      const a = buildBindingRequest();
      const b = buildBindingRequest();
      expect(a.transactionId.equals(b.transactionId)).toBe(false);
    });
  });

  describe("parseBindingResponse", () => {
    it("returns undefined for too-short buffer", () => {
      expect(parseBindingResponse(Buffer.alloc(10), Buffer.alloc(12))).toBeUndefined();
    });

    it("returns undefined for wrong message type", () => {
      const buf = Buffer.alloc(20);
      buf.writeUInt16BE(0x0001, 0); // Request, not Response
      expect(parseBindingResponse(buf, Buffer.alloc(12))).toBeUndefined();
    });

    it("returns undefined for wrong magic cookie", () => {
      const buf = Buffer.alloc(20);
      buf.writeUInt16BE(0x0101, 0); // Binding Response
      buf.writeUInt32BE(0x00000000, 4); // Wrong cookie
      expect(parseBindingResponse(buf, Buffer.alloc(12))).toBeUndefined();
    });

    it("returns undefined for wrong transaction ID", () => {
      const { buffer } = buildBindingRequest();
      // Change message type to response
      buffer.writeUInt16BE(0x0101, 0);
      const differentTxId = Buffer.alloc(12);
      expect(parseBindingResponse(buffer, differentTxId)).toBeUndefined();
    });

    it("parses XOR-MAPPED-ADDRESS attribute", () => {
      const { transactionId } = buildBindingRequest();

      // Build a response with XOR-MAPPED-ADDRESS
      const attrLen = 8; // family(1) + reserved(1) + port(2) + ip(4)
      const msgLen = 4 + attrLen; // attr header(4) + value
      const buf = Buffer.alloc(20 + msgLen);

      // Header
      buf.writeUInt16BE(0x0101, 0); // Binding Response
      buf.writeUInt16BE(msgLen, 2);
      buf.writeUInt32BE(0x2112a442, 4); // Magic cookie
      transactionId.copy(buf, 8);

      // XOR-MAPPED-ADDRESS attribute
      const attrOffset = 20;
      buf.writeUInt16BE(0x0020, attrOffset); // Attribute type
      buf.writeUInt16BE(attrLen, attrOffset + 2);
      buf[attrOffset + 4] = 0x00; // reserved
      buf[attrOffset + 5] = 0x01; // IPv4 family

      // Port 45123 XOR'd with magic cookie upper 16 bits (0x2112)
      const port = 45123;
      const xPort = port ^ (0x2112a442 >>> 16);
      buf.writeUInt16BE(xPort, attrOffset + 6);

      // IP 73.1.2.3 XOR'd with magic cookie
      const ip = (73 << 24) | (1 << 16) | (2 << 8) | 3;
      const xIp = ip ^ 0x2112a442;
      buf.writeUInt32BE(xIp >>> 0, attrOffset + 8);

      const result = parseBindingResponse(buf, transactionId);
      expect(result).toBeDefined();
      expect(result!.port).toBe(45123);
      expect(result!.ip).toBe("73.1.2.3");
    });

    it("parses MAPPED-ADDRESS attribute (fallback)", () => {
      const { transactionId } = buildBindingRequest();

      const attrLen = 8;
      const msgLen = 4 + attrLen;
      const buf = Buffer.alloc(20 + msgLen);

      buf.writeUInt16BE(0x0101, 0);
      buf.writeUInt16BE(msgLen, 2);
      buf.writeUInt32BE(0x2112a442, 4);
      transactionId.copy(buf, 8);

      // MAPPED-ADDRESS attribute (0x0001)
      const attrOffset = 20;
      buf.writeUInt16BE(0x0001, attrOffset);
      buf.writeUInt16BE(attrLen, attrOffset + 2);
      buf[attrOffset + 4] = 0x00; // reserved
      buf[attrOffset + 5] = 0x01; // IPv4
      buf.writeUInt16BE(9876, attrOffset + 6); // Port
      buf[attrOffset + 8] = 192;
      buf[attrOffset + 9] = 168;
      buf[attrOffset + 10] = 1;
      buf[attrOffset + 11] = 100;

      const result = parseBindingResponse(buf, transactionId);
      expect(result).toBeDefined();
      expect(result!.port).toBe(9876);
      expect(result!.ip).toBe("192.168.1.100");
    });

    it("skips XOR-MAPPED-ADDRESS with IPv6 family", () => {
      const { transactionId } = buildBindingRequest();

      const attrLen = 8;
      const msgLen = 4 + attrLen;
      const buf = Buffer.alloc(20 + msgLen);

      buf.writeUInt16BE(0x0101, 0);
      buf.writeUInt16BE(msgLen, 2);
      buf.writeUInt32BE(0x2112a442, 4);
      transactionId.copy(buf, 8);

      const attrOffset = 20;
      buf.writeUInt16BE(0x0020, attrOffset); // XOR-MAPPED-ADDRESS
      buf.writeUInt16BE(attrLen, attrOffset + 2);
      buf[attrOffset + 4] = 0x00;
      buf[attrOffset + 5] = 0x02; // IPv6 family — not supported

      expect(parseBindingResponse(buf, transactionId)).toBeUndefined();
    });

    it("skips MAPPED-ADDRESS with IPv6 family", () => {
      const { transactionId } = buildBindingRequest();

      const attrLen = 8;
      const msgLen = 4 + attrLen;
      const buf = Buffer.alloc(20 + msgLen);

      buf.writeUInt16BE(0x0101, 0);
      buf.writeUInt16BE(msgLen, 2);
      buf.writeUInt32BE(0x2112a442, 4);
      transactionId.copy(buf, 8);

      const attrOffset = 20;
      buf.writeUInt16BE(0x0001, attrOffset); // MAPPED-ADDRESS
      buf.writeUInt16BE(attrLen, attrOffset + 2);
      buf[attrOffset + 4] = 0x00;
      buf[attrOffset + 5] = 0x02; // IPv6 family

      expect(parseBindingResponse(buf, transactionId)).toBeUndefined();
    });

    it("skips attributes with too-short length", () => {
      const { transactionId } = buildBindingRequest();

      const attrLen = 4; // too short for address (needs 8)
      const msgLen = 4 + attrLen;
      const buf = Buffer.alloc(20 + msgLen);

      buf.writeUInt16BE(0x0101, 0);
      buf.writeUInt16BE(msgLen, 2);
      buf.writeUInt32BE(0x2112a442, 4);
      transactionId.copy(buf, 8);

      const attrOffset = 20;
      buf.writeUInt16BE(0x0020, attrOffset); // XOR-MAPPED-ADDRESS
      buf.writeUInt16BE(attrLen, attrOffset + 2);

      expect(parseBindingResponse(buf, transactionId)).toBeUndefined();
    });

    it("skips unknown attributes and continues parsing", () => {
      const { transactionId } = buildBindingRequest();

      // Unknown attr (8 bytes) + XOR-MAPPED-ADDRESS (12 bytes)
      const unknownAttrLen = 4;
      const xorAttrLen = 8;
      const msgLen = (4 + unknownAttrLen) + (4 + xorAttrLen);
      const buf = Buffer.alloc(20 + msgLen);

      buf.writeUInt16BE(0x0101, 0);
      buf.writeUInt16BE(msgLen, 2);
      buf.writeUInt32BE(0x2112a442, 4);
      transactionId.copy(buf, 8);

      // Unknown attribute
      let offset = 20;
      buf.writeUInt16BE(0x8028, offset); // FINGERPRINT (unknown for our parser)
      buf.writeUInt16BE(unknownAttrLen, offset + 2);
      offset += 4 + unknownAttrLen;

      // XOR-MAPPED-ADDRESS
      buf.writeUInt16BE(0x0020, offset);
      buf.writeUInt16BE(xorAttrLen, offset + 2);
      buf[offset + 4] = 0x00;
      buf[offset + 5] = 0x01; // IPv4
      const port = 12345;
      buf.writeUInt16BE(port ^ (0x2112a442 >>> 16), offset + 6);
      const ip = (10 << 24) | (0 << 16) | (0 << 8) | 1;
      buf.writeUInt32BE((ip ^ 0x2112a442) >>> 0, offset + 8);

      const result = parseBindingResponse(buf, transactionId);
      expect(result).toBeDefined();
      expect(result!.port).toBe(12345);
      expect(result!.ip).toBe("10.0.0.1");
    });

    it("returns undefined when no address attribute found", () => {
      const { transactionId } = buildBindingRequest();

      // Response with no attributes
      const buf = Buffer.alloc(20);
      buf.writeUInt16BE(0x0101, 0);
      buf.writeUInt16BE(0, 2);
      buf.writeUInt32BE(0x2112a442, 4);
      transactionId.copy(buf, 8);

      expect(parseBindingResponse(buf, transactionId)).toBeUndefined();
    });
  });

  describe("parseStunServer", () => {
    it("parses stun:host:port format", () => {
      expect(parseStunServer("stun:stun.l.google.com:19302")).toEqual({
        host: "stun.l.google.com",
        port: 19302,
      });
    });

    it("parses host:port format", () => {
      expect(parseStunServer("example.com:3478")).toEqual({
        host: "example.com",
        port: 3478,
      });
    });

    it("defaults port to 3478 for host-only", () => {
      expect(parseStunServer("example.com")).toEqual({
        host: "example.com",
        port: 3478,
      });
    });

    it("defaults port to 3478 for invalid port", () => {
      expect(parseStunServer("example.com:abc")).toEqual({
        host: "example.com",
        port: 3478,
      });
    });
  });
});
