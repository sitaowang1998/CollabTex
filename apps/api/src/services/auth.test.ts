import jwt from "jsonwebtoken";
import { describe, expect, it } from "vitest";
import { signToken, verifyToken } from "./auth.js";

describe("auth service", () => {
  const secret = "test_secret";

  it("verifies tokens created by signToken", () => {
    const token = signToken("alice", secret);

    expect(verifyToken(token, secret)).toEqual({ sub: "alice" });
  });

  it("rejects malformed tokens", () => {
    expect(() => verifyToken("not-a-jwt", secret)).toThrow();
  });

  it("rejects tokens without a string sub", () => {
    const token = jwt.sign({}, secret, { algorithm: "HS256" });

    expect(() => verifyToken(token, secret)).toThrow("Invalid token payload");
  });

  it("rejects tokens with a non-string sub", () => {
    const token = jwt.sign({ sub: 123 }, secret, { algorithm: "HS256" });

    expect(() => verifyToken(token, secret)).toThrow("Invalid token payload");
  });
});
