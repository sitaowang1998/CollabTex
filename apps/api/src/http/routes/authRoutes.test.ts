import request from "supertest";
import { describe, expect, it } from "vitest";
import { signToken } from "../../services/auth.js";
import { createTestApp, testConfig } from "../../test/helpers/appFactory.js";

describe("auth routes", () => {
  it("returns a token for a valid login request", async () => {
    const app = createTestApp();

    const response = await request(app)
      .post("/api/login")
      .send({ username: "alice" })
      .expect(200);

    expect(response.body).toEqual({
      token: expect.any(String)
    });
  });

  it("rejects login when username is missing", async () => {
    const app = createTestApp();

    const response = await request(app).post("/api/login").send({}).expect(400);

    expect(response.body).toEqual({ error: "username required" });
  });

  it("returns the authenticated user for a valid bearer token", async () => {
    const app = createTestApp();
    const token = signToken("alice", testConfig.jwtSecret);

    const response = await request(app)
      .get("/api/me")
      .set("authorization", `Bearer ${token}`)
      .expect(200);

    expect(response.body).toEqual({ userId: "alice" });
  });

  it("rejects requests without a bearer token", async () => {
    const app = createTestApp();

    const response = await request(app).get("/api/me").expect(401);

    expect(response.body).toEqual({ error: "missing token" });
  });

  it("rejects requests with an invalid bearer token", async () => {
    const app = createTestApp();

    const response = await request(app)
      .get("/api/me")
      .set("authorization", "Bearer definitely-not-a-jwt")
      .expect(401);

    expect(response.body).toEqual({ error: "invalid token" });
  });
});
