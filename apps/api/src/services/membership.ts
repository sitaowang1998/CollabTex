import type {
  AddProjectMemberRequest,
  ProjectMember,
  ProjectRole,
} from "@collab-tex/shared";
import type { StoredUser } from "./auth.js";
import type { ProjectAccessService } from "./projectAccess.js";

export type MembershipRepository = {
  listMembers: (projectId: string) => Promise<ProjectMember[]>;
  findMembership: (
    projectId: string,
    userId: string,
  ) => Promise<ProjectMember | null>;
  createMembership: (input: {
    projectId: string;
    userId: string;
    role: ProjectRole;
  }) => Promise<ProjectMember | null>;
  updateMembershipRole: (input: {
    projectId: string;
    userId: string;
    role: ProjectRole;
  }) => Promise<ProjectMember | null>;
  deleteMembership: (projectId: string, userId: string) => Promise<boolean>;
  countAdmins: (projectId: string) => Promise<number>;
};

export type MembershipUserLookup = {
  findByEmail: (email: string) => Promise<StoredUser | null>;
};

export type AddProjectMemberInput = {
  projectId: string;
  actorUserId: string;
} & AddProjectMemberRequest;

export type UpdateProjectMemberInput = {
  projectId: string;
  actorUserId: string;
  targetUserId: string;
  role: ProjectRole;
};

export type DeleteProjectMemberInput = {
  projectId: string;
  actorUserId: string;
  targetUserId: string;
};

export type MembershipService = {
  listMembers: (projectId: string, userId: string) => Promise<ProjectMember[]>;
  addMember: (input: AddProjectMemberInput) => Promise<ProjectMember>;
  updateMemberRole: (input: UpdateProjectMemberInput) => Promise<ProjectMember>;
  deleteMember: (input: DeleteProjectMemberInput) => Promise<void>;
};

export class DuplicateProjectMembershipError extends Error {
  constructor() {
    super("Project membership already exists");
  }
}

export class MembershipUserNotFoundError extends Error {
  constructor() {
    super("User not found");
  }
}

export class ProjectMembershipNotFoundError extends Error {
  constructor() {
    super("Project membership not found");
  }
}

export class LastProjectAdminRemovalError extends Error {
  constructor() {
    super("Cannot remove the last admin from a project");
  }
}

export class ProjectAdminOrSelfRequiredError extends Error {
  constructor() {
    super("Project admin role or self-removal is required");
  }
}

export function createMembershipService({
  membershipRepository,
  userLookup,
  projectAccessService,
}: {
  membershipRepository: MembershipRepository;
  userLookup: MembershipUserLookup;
  projectAccessService: ProjectAccessService;
}): MembershipService {
  return {
    listMembers: async (projectId, userId) => {
      await projectAccessService.requireProjectMember(projectId, userId);

      return membershipRepository.listMembers(projectId);
    },
    addMember: async (input) => {
      const project = await projectAccessService.requireProjectRole(
        input.projectId,
        input.actorUserId,
        ["admin"],
      );
      const email = normalizeEmail(input.email);
      const user = await userLookup.findByEmail(email);

      if (!user) {
        throw new MembershipUserNotFoundError();
      }

      const createdMembership = await membershipRepository.createMembership({
        projectId: project.project.id,
        userId: user.id,
        role: input.role,
      });

      if (!createdMembership) {
        throw new Error("Expected active project membership to be created");
      }

      return createdMembership;
    },
    updateMemberRole: async (input) => {
      const project = await projectAccessService.requireProjectRole(
        input.projectId,
        input.actorUserId,
        ["admin"],
      );
      const membership = await membershipRepository.findMembership(
        project.project.id,
        input.targetUserId,
      );

      if (!membership) {
        throw new ProjectMembershipNotFoundError();
      }

      await ensureLastAdminPreserved({
        membershipRepository,
        projectId: project.project.id,
        currentRole: membership.role,
        nextRole: input.role,
      });

      const updatedMembership = await membershipRepository.updateMembershipRole(
        {
          projectId: project.project.id,
          userId: input.targetUserId,
          role: input.role,
        },
      );

      if (!updatedMembership) {
        throw new ProjectMembershipNotFoundError();
      }

      return updatedMembership;
    },
    deleteMember: async (input) => {
      const project = await projectAccessService.requireProjectMember(
        input.projectId,
        input.actorUserId,
      );

      if (
        project.myRole !== "admin" &&
        input.actorUserId !== input.targetUserId
      ) {
        throw new ProjectAdminOrSelfRequiredError();
      }

      const membership = await membershipRepository.findMembership(
        project.project.id,
        input.targetUserId,
      );

      if (!membership) {
        throw new ProjectMembershipNotFoundError();
      }

      await ensureLastAdminPreserved({
        membershipRepository,
        projectId: project.project.id,
        currentRole: membership.role,
        nextRole: null,
      });

      const deleted = await membershipRepository.deleteMembership(
        project.project.id,
        input.targetUserId,
      );

      if (!deleted) {
        throw new ProjectMembershipNotFoundError();
      }
    },
  };
}

async function ensureLastAdminPreserved({
  membershipRepository,
  projectId,
  currentRole,
  nextRole,
}: {
  membershipRepository: MembershipRepository;
  projectId: string;
  currentRole: ProjectRole;
  nextRole: ProjectRole | null;
}) {
  if (currentRole !== "admin" || nextRole === "admin") {
    return;
  }

  const adminCount = await membershipRepository.countAdmins(projectId);

  if (adminCount <= 1) {
    throw new LastProjectAdminRemovalError();
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
