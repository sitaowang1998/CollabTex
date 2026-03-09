import { describe, expect, it, vi } from "vitest";
import type { ProjectMember } from "@collab-tex/shared";
import {
  DuplicateProjectMembershipError,
  LastProjectAdminRemovalError,
  MembershipUserNotFoundError,
  ProjectAdminOrSelfRequiredError,
  ProjectMembershipNotFoundError,
  createMembershipService,
  type MembershipRepository,
  type MembershipUserLookup,
} from "./membership.js";
import type { ProjectAccessService, ProjectWithRole } from "./projectAccess.js";
import { ProjectAdminRequiredError, ProjectNotFoundError } from "./project.js";

describe("membership service", () => {
  it("lists members for any project member", async () => {
    const { membershipRepository, projectAccessService, userLookup } =
      createDependencies();
    const members = [createProjectMember()];
    projectAccessService.requireProjectMember.mockResolvedValue(
      createProjectWithRole("reader"),
    );
    membershipRepository.listMembers.mockResolvedValue(members);
    const service = createMembershipService({
      membershipRepository,
      projectAccessService,
      userLookup,
    });

    await expect(service.listMembers("project-1", "user-1")).resolves.toBe(
      members,
    );
  });

  it("maps a concurrently deleted project during list to not found", async () => {
    const { membershipRepository, projectAccessService, userLookup } =
      createDependencies();
    projectAccessService.requireProjectMember.mockResolvedValue(
      createProjectWithRole("reader"),
    );
    membershipRepository.listMembers.mockResolvedValue(null);
    const service = createMembershipService({
      membershipRepository,
      projectAccessService,
      userLookup,
    });

    await expect(
      service.listMembers("project-1", "user-1"),
    ).rejects.toBeInstanceOf(ProjectNotFoundError);
  });

  it("normalizes invite emails before user lookup", async () => {
    const { membershipRepository, projectAccessService, userLookup } =
      createDependencies();
    const createdMember = createProjectMember({
      userId: "user-2",
      email: "bob@example.com",
      role: "editor",
    });
    projectAccessService.requireProjectRole.mockResolvedValue(
      createProjectWithRole("admin"),
    );
    userLookup.findByEmail.mockResolvedValue({
      id: "user-2",
      email: "bob@example.com",
      name: "Bob",
      passwordHash: "hash",
    });
    membershipRepository.createMembership.mockResolvedValue(createdMember);
    const service = createMembershipService({
      membershipRepository,
      projectAccessService,
      userLookup,
    });

    await expect(
      service.addMember({
        projectId: "project-1",
        actorUserId: "user-1",
        email: " Bob@Example.com ",
        role: "editor",
      }),
    ).resolves.toEqual(createdMember);

    expect(projectAccessService.requireProjectRole).toHaveBeenCalledWith(
      "project-1",
      "user-1",
      ["admin"],
    );
    expect(
      projectAccessService.requireProjectRole.mock.invocationCallOrder[0],
    ).toBeLessThan(userLookup.findByEmail.mock.invocationCallOrder[0] ?? 0);
    expect(userLookup.findByEmail).toHaveBeenCalledWith("bob@example.com");
    expect(membershipRepository.createMembership).toHaveBeenCalledWith({
      projectId: "project-1",
      actorUserId: "user-1",
      userId: "user-2",
      role: "editor",
    });
  });

  it("rejects invites for missing users", async () => {
    const { membershipRepository, projectAccessService, userLookup } =
      createDependencies();
    projectAccessService.requireProjectRole.mockResolvedValue(
      createProjectWithRole("admin"),
    );
    userLookup.findByEmail.mockResolvedValue(null);
    const service = createMembershipService({
      membershipRepository,
      projectAccessService,
      userLookup,
    });

    await expect(
      service.addMember({
        projectId: "project-1",
        actorUserId: "user-1",
        email: "missing@example.com",
        role: "reader",
      }),
    ).rejects.toBeInstanceOf(MembershipUserNotFoundError);
  });

  it("rejects unauthorized invites before looking up the target email", async () => {
    const { membershipRepository, projectAccessService, userLookup } =
      createDependencies();
    projectAccessService.requireProjectRole.mockRejectedValue(
      new ProjectAdminRequiredError(),
    );
    const service = createMembershipService({
      membershipRepository,
      projectAccessService,
      userLookup,
    });

    await expect(
      service.addMember({
        projectId: "project-1",
        actorUserId: "user-1",
        email: "missing@example.com",
        role: "reader",
      }),
    ).rejects.toBeInstanceOf(ProjectAdminRequiredError);

    expect(userLookup.findByEmail).not.toHaveBeenCalled();
    expect(membershipRepository.createMembership).not.toHaveBeenCalled();
  });

  it("rejects demoting the last admin", async () => {
    const { membershipRepository, projectAccessService, userLookup } =
      createDependencies();
    membershipRepository.updateMembershipRole.mockRejectedValue(
      new LastProjectAdminRemovalError(),
    );
    const service = createMembershipService({
      membershipRepository,
      projectAccessService,
      userLookup,
    });

    await expect(
      service.updateMemberRole({
        projectId: "project-1",
        actorUserId: "user-1",
        targetUserId: "user-1",
        role: "editor",
      }),
    ).rejects.toBeInstanceOf(LastProjectAdminRemovalError);
  });

  it("rejects deleting another member when the caller is not an admin", async () => {
    const { membershipRepository, projectAccessService, userLookup } =
      createDependencies();
    membershipRepository.deleteMembership.mockRejectedValue(
      new ProjectAdminOrSelfRequiredError(),
    );
    const service = createMembershipService({
      membershipRepository,
      projectAccessService,
      userLookup,
    });

    await expect(
      service.deleteMember({
        projectId: "project-1",
        actorUserId: "user-2",
        targetUserId: "user-3",
      }),
    ).rejects.toBeInstanceOf(ProjectAdminOrSelfRequiredError);
  });

  it("allows self-removal for non-admin members", async () => {
    const { membershipRepository, projectAccessService, userLookup } =
      createDependencies();
    projectAccessService.requireProjectMember.mockResolvedValue(
      createProjectWithRole("reader"),
    );
    membershipRepository.deleteMembership.mockResolvedValue(true);
    const service = createMembershipService({
      membershipRepository,
      projectAccessService,
      userLookup,
    });

    await expect(
      service.deleteMember({
        projectId: "project-1",
        actorUserId: "user-2",
        targetUserId: "user-2",
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects updates for missing memberships", async () => {
    const { membershipRepository, projectAccessService, userLookup } =
      createDependencies();
    membershipRepository.updateMembershipRole.mockResolvedValue(null);
    const service = createMembershipService({
      membershipRepository,
      projectAccessService,
      userLookup,
    });

    await expect(
      service.updateMemberRole({
        projectId: "project-1",
        actorUserId: "user-1",
        targetUserId: "user-2",
        role: "editor",
      }),
    ).rejects.toBeInstanceOf(ProjectMembershipNotFoundError);
  });

  it("passes through duplicate membership conflicts", async () => {
    const { membershipRepository, projectAccessService, userLookup } =
      createDependencies();
    projectAccessService.requireProjectRole.mockResolvedValue(
      createProjectWithRole("admin"),
    );
    userLookup.findByEmail.mockResolvedValue({
      id: "user-2",
      email: "bob@example.com",
      name: "Bob",
      passwordHash: "hash",
    });
    membershipRepository.createMembership.mockRejectedValue(
      new DuplicateProjectMembershipError(),
    );
    const service = createMembershipService({
      membershipRepository,
      projectAccessService,
      userLookup,
    });

    await expect(
      service.addMember({
        projectId: "project-1",
        actorUserId: "user-1",
        email: "bob@example.com",
        role: "reader",
      }),
    ).rejects.toBeInstanceOf(DuplicateProjectMembershipError);
  });
});

function createDependencies() {
  return {
    membershipRepository: {
      listMembers: vi.fn<MembershipRepository["listMembers"]>(),
      createMembership: vi.fn<MembershipRepository["createMembership"]>(),
      updateMembershipRole:
        vi.fn<MembershipRepository["updateMembershipRole"]>(),
      deleteMembership: vi.fn<MembershipRepository["deleteMembership"]>(),
    },
    projectAccessService: {
      requireProjectMember:
        vi.fn<ProjectAccessService["requireProjectMember"]>(),
      requireProjectRole: vi.fn<ProjectAccessService["requireProjectRole"]>(),
    },
    userLookup: {
      findByEmail: vi.fn<MembershipUserLookup["findByEmail"]>(),
    },
  };
}

function createProjectWithRole(
  role: ProjectWithRole["myRole"],
): ProjectWithRole {
  return {
    project: {
      id: "project-1",
      name: "Project One",
      createdAt: new Date("2026-03-01T12:00:00.000Z"),
      updatedAt: new Date("2026-03-01T12:00:00.000Z"),
      tombstoneAt: null,
    },
    myRole: role,
  };
}

function createProjectMember(
  overrides: Partial<ProjectMember> = {},
): ProjectMember {
  return {
    userId: "user-1",
    email: "alice@example.com",
    name: "Alice",
    role: "admin",
    ...overrides,
  };
}
