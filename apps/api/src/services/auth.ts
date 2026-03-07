import jwt from "jsonwebtoken";
import type {
  AuthResponse,
  AuthUser,
  JwtPayload,
  LoginRequest,
  RegisterRequest,
} from "@collab-tex/shared";

export type StoredUser = {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
};

export type CreateStoredUserInput = {
  email: string;
  name: string;
  passwordHash: string;
};

export type AuthUserRepository = {
  findByEmail: (email: string) => Promise<StoredUser | null>;
  findById: (id: string) => Promise<StoredUser | null>;
  create: (input: CreateStoredUserInput) => Promise<StoredUser>;
};

export type PasswordHasher = {
  hash: (password: string) => Promise<string>;
  verify: (password: string, passwordHash: string) => Promise<boolean>;
};

export type AuthService = {
  register: (input: RegisterRequest) => Promise<AuthResponse>;
  login: (input: LoginRequest) => Promise<AuthResponse>;
  getAuthenticatedUser: (userId: string) => Promise<AuthUser>;
};

export class DuplicateEmailError extends Error {
  constructor() {
    super("Email is already registered");
  }
}

export class InvalidCredentialsError extends Error {
  constructor() {
    super("Invalid email or password");
  }
}

export class AuthenticatedUserNotFoundError extends Error {
  constructor() {
    super("Authenticated user not found");
  }
}

export function signToken(userId: string, jwtSecret: string): string {
  const payload: JwtPayload = { sub: userId };

  return jwt.sign(payload, jwtSecret, {
    algorithm: "HS256",
    expiresIn: "15m",
  });
}

export function verifyToken(token: string, jwtSecret: string): JwtPayload {
  const decoded = jwt.verify(token, jwtSecret, {
    algorithms: ["HS256"],
  });

  if (!isJwtPayload(decoded)) {
    throw new Error("Invalid token payload");
  }

  return { sub: decoded.sub };
}

export function createAuthService({
  userRepository,
  passwordHasher,
  jwtSecret,
  dummyPasswordHash,
}: {
  userRepository: AuthUserRepository;
  passwordHasher: PasswordHasher;
  jwtSecret: string;
  dummyPasswordHash: string;
}): AuthService {
  return {
    register: async (input) => {
      const email = normalizeEmail(input.email);
      const name = normalizeName(input.name);
      const existingUser = await userRepository.findByEmail(email);

      if (existingUser) {
        throw new DuplicateEmailError();
      }

      const passwordHash = await passwordHasher.hash(input.password);
      const user = await userRepository.create({
        email,
        name,
        passwordHash,
      });

      return {
        token: signToken(user.id, jwtSecret),
        user: toAuthUser(user),
      };
    },
    login: async (input) => {
      const email = normalizeEmail(input.email);
      const user = await userRepository.findByEmail(email);
      const passwordHashToVerify = user?.passwordHash ?? dummyPasswordHash;

      let isValidPassword = false;
      try {
        isValidPassword = await passwordHasher.verify(
          input.password,
          passwordHashToVerify,
        );
      } catch {
        throw new InvalidCredentialsError();
      }

      if (!user || !isValidPassword) {
        throw new InvalidCredentialsError();
      }

      return {
        token: signToken(user.id, jwtSecret),
        user: toAuthUser(user),
      };
    },
    getAuthenticatedUser: async (userId) => {
      const user = await userRepository.findById(userId);

      if (!user) {
        throw new AuthenticatedUserNotFoundError();
      }

      return toAuthUser(user);
    },
  };
}

function isJwtPayload(value: unknown): value is JwtPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as { sub?: unknown };

  return typeof candidate.sub === "string";
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeName(name: string): string {
  return name.trim();
}

function toAuthUser(user: StoredUser): AuthUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
  };
}
