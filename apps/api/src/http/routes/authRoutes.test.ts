import request from "supertest";
import { describe, expect, it } from "vitest";
import { signToken } from "../../services/auth.js";
import { createTestApp, testConfig } from "../../test/helpers/appFactory.js";

describe("auth routes", () => {
  it("registers a user and returns an auth response", async () => {
    const app = createTestApp();

    const response = await request(app)
      .post("/api/auth/register")
      .send({
        email: " Alice@example.com ",
        name: "Alice",
        password: "correct horse battery staple",
      })
      .expect(201);

    expect(response.body).toEqual({
      token: expect.any(String),
      user: {
        id: expect.any(String),
        email: "alice@example.com",
        name: "Alice",
      },
    });
  });

  it("rejects registration when email is missing", async () => {
    const app = createTestApp();

    const response = await request(app)
      .post("/api/auth/register")
      .send({
        name: "Alice",
        password: "secret",
      })
      .expect(400);

    expect(response.body).toEqual({ error: "email is required" });
  });

  it("rejects array request bodies", async () => {
    const app = createTestApp();

    const response = await request(app)
      .post("/api/auth/register")
      .send([])
      .expect(400);

    expect(response.body).toEqual({ error: "request body must be an object" });
  });

  it("rejects whitespace-only registration passwords", async () => {
    const app = createTestApp();

    const response = await request(app)
      .post("/api/auth/register")
      .send({
        email: "alice@example.com",
        name: "Alice",
        password: "   ",
      })
      .expect(400);

    expect(response.body).toEqual({ error: "password is required" });
  });

  it("rejects duplicate registration emails", async () => {
    const app = createTestApp();

    await request(app).post("/api/auth/register").send({
      email: "alice@example.com",
      name: "Alice",
      password: "secret",
    });

    const response = await request(app)
      .post("/api/auth/register")
      .send({
        email: "alice@example.com",
        name: "Alice 2",
        password: "secret",
      })
      .expect(409);

    expect(response.body).toEqual({ error: "email already registered" });
  });

  it("logs in with valid credentials", async () => {
    const app = createTestApp();

    await request(app).post("/api/auth/register").send({
      email: "alice@example.com",
      name: "Alice",
      password: "secret",
    });

    const response = await request(app)
      .post("/api/auth/login")
      .send({
        email: " Alice@example.com ",
        password: "secret",
      })
      .expect(200);

    expect(response.body).toEqual({
      token: expect.any(String),
      user: {
        id: expect.any(String),
        email: "alice@example.com",
        name: "Alice",
      },
    });
  });

  it("rejects login with invalid credentials", async () => {
    const app = createTestApp();

    await request(app).post("/api/auth/register").send({
      email: "alice@example.com",
      name: "Alice",
      password: "secret",
    });

    const response = await request(app)
      .post("/api/auth/login")
      .send({
        email: "alice@example.com",
        password: "wrong-password",
      })
      .expect(401);

    expect(response.body).toEqual({ error: "invalid email or password" });
  });

  it("rejects whitespace-only login passwords", async () => {
    const app = createTestApp();

    const response = await request(app)
      .post("/api/auth/login")
      .send({
        email: "alice@example.com",
        password: "   ",
      })
      .expect(400);

    expect(response.body).toEqual({ error: "password is required" });
  });

  it("returns the authenticated user for a valid bearer token", async () => {
    const app = createTestApp();

    const registerResponse = await request(app)
      .post("/api/auth/register")
      .send({
        email: "alice@example.com",
        name: "Alice",
        password: "secret",
      });
    const token = registerResponse.body.token as string;

    const response = await request(app)
      .get("/api/auth/me")
      .set("authorization", `Bearer ${token}`)
      .expect(200);

    expect(response.body).toEqual({
      user: {
        id: expect.any(String),
        email: "alice@example.com",
        name: "Alice",
      },
    });
  });

  it("rejects requests without a bearer token", async () => {
    const app = createTestApp();

    const response = await request(app).get("/api/auth/me").expect(401);

    expect(response.body).toEqual({ error: "missing token" });
  });

  it("rejects requests with an invalid bearer token", async () => {
    const app = createTestApp();

    const response = await request(app)
      .get("/api/auth/me")
      .set("authorization", "Bearer definitely-not-a-jwt")
      .expect(401);

    expect(response.body).toEqual({ error: "invalid token" });
  });

  it("returns invalid token when the token user does not exist", async () => {
    const app = createTestApp();
    const token = signToken("missing-user-id", testConfig.jwtSecret);

    const response = await request(app)
      .get("/api/auth/me")
      .set("authorization", `Bearer ${token}`)
      .expect(401);

    expect(response.body).toEqual({ error: "invalid token" });
  });
});
