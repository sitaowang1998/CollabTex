import request from "supertest";
import { describe, expect, it } from "vitest";
import { signToken } from "../../services/auth.js";
import { createTestApp, testConfig } from "./appFactory.js";

describe("createTestApp document repository parity", () => {
  it("rewrites folder descendants during moves", async () => {
    const app = createTestApp();
    const token = createToken();
    const projectId = "6f35c2aa-fd34-4905-a370-7d9642244166";

    await createFile(app, token, projectId, "/docs/main.tex");
    await createFile(app, token, projectId, "/docs/chapters/one.tex");

    await request(app)
      .patch(`/api/projects/${projectId}/nodes/move`)
      .set("authorization", `Bearer ${token}`)
      .send({
        path: "/docs",
        destinationParentPath: "/archive",
      })
      .expect(204);

    const treeResponse = await request(app)
      .get(`/api/projects/${projectId}/tree`)
      .set("authorization", `Bearer ${token}`)
      .expect(200);

    expect(treeResponse.body).toEqual({
      nodes: [
        {
          type: "folder",
          name: "archive",
          path: "/archive",
          children: [
            {
              type: "folder",
              name: "docs",
              path: "/archive/docs",
              children: [
                {
                  type: "folder",
                  name: "chapters",
                  path: "/archive/docs/chapters",
                  children: [
                    {
                      type: "file",
                      name: "one.tex",
                      path: "/archive/docs/chapters/one.tex",
                      documentId: "document-2",
                      documentKind: "text",
                      mime: null,
                    },
                  ],
                },
                {
                  type: "file",
                  name: "main.tex",
                  path: "/archive/docs/main.tex",
                  documentId: "document-1",
                  documentKind: "text",
                  mime: null,
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it("deletes folder descendants without touching sibling prefixes", async () => {
    const app = createTestApp();
    const token = createToken();
    const projectId = "6f35c2aa-fd34-4905-a370-7d9642244166";

    await createFile(app, token, projectId, "/docs/main.tex");
    await createFile(app, token, projectId, "/docs/chapters/one.tex");
    await createFile(app, token, projectId, "/docs-2/keep.tex");

    await request(app)
      .delete(`/api/projects/${projectId}/nodes`)
      .set("authorization", `Bearer ${token}`)
      .send({
        path: "/docs",
      })
      .expect(204);

    const treeResponse = await request(app)
      .get(`/api/projects/${projectId}/tree`)
      .set("authorization", `Bearer ${token}`)
      .expect(200);

    expect(treeResponse.body).toEqual({
      nodes: [
        {
          type: "folder",
          name: "docs-2",
          path: "/docs-2",
          children: [
            {
              type: "file",
              name: "keep.tex",
              path: "/docs-2/keep.tex",
              documentId: "document-3",
              documentKind: "text",
              mime: null,
            },
          ],
        },
      ],
    });
  });
});

function createToken() {
  return signToken("user-1", testConfig.jwtSecret);
}

async function createFile(
  app: ReturnType<typeof createTestApp>,
  token: string,
  projectId: string,
  path: string,
) {
  await request(app)
    .post(`/api/projects/${projectId}/files`)
    .set("authorization", `Bearer ${token}`)
    .send({
      path,
      kind: "text",
    })
    .expect(201);
}
