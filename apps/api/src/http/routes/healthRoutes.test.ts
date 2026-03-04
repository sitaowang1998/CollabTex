import request from "supertest";
import { describe, expect, it } from "vitest";
import { createTestApp } from "../../test/helpers/appFactory.js";

describe("health routes", () => {
  it("returns a healthy response", async () => {
    const app = createTestApp();

    const response = await request(app).get("/api/health").expect(200);

    expect(response.body).toEqual({ ok: true });
  });
});
