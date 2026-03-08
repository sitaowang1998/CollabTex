import jwt from "jsonwebtoken";
import { describe, expect, it, vi } from "vitest";
import {
  AuthenticatedUserNotFoundError,
  DuplicateEmailError,
  InvalidCredentialsError,
  createAuthService,
  signToken,
  verifyToken,
  type AuthUserRepository,
  type PasswordHasher,
} from "./auth.js";

describe("auth service", () => {
  const secret = "test_secret";
  const dummyPasswordHash = "hashed:__dummy_password__";

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

  it("rejects tokens with an empty string sub", () => {
    const token = jwt.sign({ sub: "   " }, secret, { algorithm: "HS256" });

    expect(() => verifyToken(token, secret)).toThrow("Invalid token payload");
  });

  it("registers users with normalized email", async () => {
    const service = createAuthService({
      userRepository: createInMemoryUserRepository(),
      passwordHasher: createPasswordHasher(),
      jwtSecret: secret,
      dummyPasswordHash,
    });

    const response = await service.register({
      email: " Alice@Example.com ",
      name: " Alice ",
      password: "secret",
    });

    expect(response).toEqual({
      token: expect.any(String),
      user: {
        id: "user-1",
        email: "alice@example.com",
        name: "Alice",
      },
    });
  });

  it("rejects duplicate emails during registration", async () => {
    const service = createAuthService({
      userRepository: createInMemoryUserRepository(),
      passwordHasher: createPasswordHasher(),
      jwtSecret: secret,
      dummyPasswordHash,
    });

    await service.register({
      email: "alice@example.com",
      name: "Alice",
      password: "secret",
    });

    await expect(
      service.register({
        email: "ALICE@example.com",
        name: "Alice",
        password: "secret",
      }),
    ).rejects.toBeInstanceOf(DuplicateEmailError);
  });

  it("rejects duplicate emails before hashing", async () => {
    const passwordHasher = {
      hash: async () => {
        throw new Error("hash should not be called");
      },
      verify: async () => true,
    } satisfies PasswordHasher;
    const service = createAuthService({
      userRepository: {
        findByEmail: async () => ({
          id: "user-1",
          email: "alice@example.com",
          name: "Alice",
          passwordHash: "hashed:secret",
        }),
        findById: async () => null,
        create: async () => {
          throw new Error("create should not be called");
        },
      },
      passwordHasher,
      jwtSecret: secret,
      dummyPasswordHash,
    });

    await expect(
      service.register({
        email: "ALICE@example.com",
        name: "Alice",
        password: "secret",
      }),
    ).rejects.toBeInstanceOf(DuplicateEmailError);
  });

  it("still maps duplicate email races from create", async () => {
    const service = createAuthService({
      userRepository: {
        findByEmail: async () => null,
        findById: async () => null,
        create: async () => {
          throw new DuplicateEmailError();
        },
      },
      passwordHasher: createPasswordHasher(),
      jwtSecret: secret,
      dummyPasswordHash,
    });

    await expect(
      service.register({
        email: "alice@example.com",
        name: "Alice",
        password: "secret",
      }),
    ).rejects.toBeInstanceOf(DuplicateEmailError);
  });

  it("logs in with normalized email and valid password", async () => {
    const service = createAuthService({
      userRepository: createInMemoryUserRepository(),
      passwordHasher: createPasswordHasher(),
      jwtSecret: secret,
      dummyPasswordHash,
    });

    await service.register({
      email: "alice@example.com",
      name: "Alice",
      password: "secret",
    });

    const response = await service.login({
      email: " Alice@example.com ",
      password: "secret",
    });

    expect(response.user).toEqual({
      id: "user-1",
      email: "alice@example.com",
      name: "Alice",
    });
    expect(typeof response.token).toBe("string");
  });

  it("rejects login for an unknown email", async () => {
    const verify = vi.fn().mockResolvedValue(false);
    const service = createAuthService({
      userRepository: createInMemoryUserRepository(),
      passwordHasher: {
        hash: async (password) => `hashed:${password}`,
        verify,
      },
      jwtSecret: secret,
      dummyPasswordHash,
    });

    await expect(
      service.login({
        email: "alice@example.com",
        password: "secret",
      }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);

    expect(verify).toHaveBeenCalledWith("secret", dummyPasswordHash);
  });

  it("rejects unknown email when dummy hash verification throws", async () => {
    const service = createAuthService({
      userRepository: createInMemoryUserRepository(),
      passwordHasher: {
        hash: async (password) => `hashed:${password}`,
        verify: async () => {
          throw new Error("Malformed dummy password hash");
        },
      },
      jwtSecret: secret,
      dummyPasswordHash,
    });

    await expect(
      service.login({
        email: "alice@example.com",
        password: "secret",
      }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it("rejects login with a wrong password", async () => {
    const service = createAuthService({
      userRepository: createInMemoryUserRepository(),
      passwordHasher: createPasswordHasher(),
      jwtSecret: secret,
      dummyPasswordHash,
    });

    await service.register({
      email: "alice@example.com",
      name: "Alice",
      password: "secret",
    });

    await expect(
      service.login({
        email: "alice@example.com",
        password: "wrong",
      }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it("rejects login when password verification throws", async () => {
    const service = createAuthService({
      userRepository: createInMemoryUserRepository(),
      passwordHasher: {
        hash: async (password) => `hashed:${password}`,
        verify: async () => {
          throw new Error("Malformed password hash");
        },
      },
      jwtSecret: secret,
      dummyPasswordHash,
    });

    await service.register({
      email: "alice@example.com",
      name: "Alice",
      password: "secret",
    });

    await expect(
      service.login({
        email: "alice@example.com",
        password: "secret",
      }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it("returns the authenticated user for a known id", async () => {
    const service = createAuthService({
      userRepository: createInMemoryUserRepository(),
      passwordHasher: createPasswordHasher(),
      jwtSecret: secret,
      dummyPasswordHash,
    });

    await service.register({
      email: "alice@example.com",
      name: "Alice",
      password: "secret",
    });

    await expect(service.getAuthenticatedUser("user-1")).resolves.toEqual({
      id: "user-1",
      email: "alice@example.com",
      name: "Alice",
    });
  });

  it("rejects authenticated user lookup for an unknown id", async () => {
    const service = createAuthService({
      userRepository: createInMemoryUserRepository(),
      passwordHasher: createPasswordHasher(),
      jwtSecret: secret,
      dummyPasswordHash,
    });

    await expect(
      service.getAuthenticatedUser("missing"),
    ).rejects.toBeInstanceOf(AuthenticatedUserNotFoundError);
  });
});

function createPasswordHasher(): PasswordHasher {
  return {
    hash: async (password) => `hashed:${password}`,
    verify: async (password, passwordHash) =>
      passwordHash === `hashed:${password}`,
  };
}

function createInMemoryUserRepository(): AuthUserRepository {
  const usersById = new Map<
    string,
    { id: string; email: string; name: string; passwordHash: string }
  >();
  let nextId = 1;

  return {
    findByEmail: async (email) => {
      for (const user of usersById.values()) {
        if (user.email === email) {
          return user;
        }
      }

      return null;
    },
    findById: async (id) => usersById.get(id) ?? null,
    create: async ({ email, name, passwordHash }) => {
      for (const user of usersById.values()) {
        if (user.email === email) {
          throw new DuplicateEmailError();
        }
      }

      const user = {
        id: `user-${nextId}`,
        email,
        name,
        passwordHash,
      };
      nextId += 1;
      usersById.set(user.id, user);

      return user;
    },
  };
}
