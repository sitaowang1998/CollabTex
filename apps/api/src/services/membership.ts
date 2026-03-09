import type {
  AddProjectMemberRequest,
  ProjectMember,
  ProjectRole,
} from "@collab-tex/shared";
import type { StoredUser } from "./auth.js";
import type { ProjectAccessService } from "./projectAccess.js";
import { ProjectNotFoundError } from "./project.js";

export type MembershipRepository = {
  listMembersForUser: (
    projectId: string,
    userId: string,
  ) => Promise<ProjectMember[] | null>;
  createMembership: (input: {
    projectId: string;
    actorUserId: string;
    userId: string;
    role: ProjectRole;
  }) => Promise<ProjectMember>;
  updateMembershipRole: (input: {
    projectId: string;
    actorUserId: string;
    userId: string;
    role: ProjectRole;
  }) => Promise<ProjectMember | null>;
  deleteMembership: (input: {
    projectId: string;
    actorUserId: string;
    userId: string;
  }) => Promise<boolean>;
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
      const members = await membershipRepository.listMembersForUser(
        projectId,
        userId,
      );

      if (!members) {
        throw new ProjectNotFoundError();
      }

      return members;
    },
    addMember: async (input) => {
      // Reject unauthorized callers before email lookup to avoid turning this
      // endpoint into an account-enumeration probe. The repository still
      // re-checks admin status inside its write transaction for race safety.
      await projectAccessService.requireProjectRole(
        input.projectId,
        input.actorUserId,
        ["admin"],
      );
      const email = normalizeEmail(input.email);
      const user = await userLookup.findByEmail(email);

      if (!user) {
        throw new MembershipUserNotFoundError();
      }

      return membershipRepository.createMembership({
        projectId: input.projectId,
        actorUserId: input.actorUserId,
        userId: user.id,
        role: input.role,
      });
    },
    updateMemberRole: async (input) => {
      const updatedMembership = await membershipRepository.updateMembershipRole(
        {
          projectId: input.projectId,
          actorUserId: input.actorUserId,
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
      const deleted = await membershipRepository.deleteMembership({
        projectId: input.projectId,
        actorUserId: input.actorUserId,
        userId: input.targetUserId,
      });

      if (!deleted) {
        throw new ProjectMembershipNotFoundError();
      }
    },
  };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
