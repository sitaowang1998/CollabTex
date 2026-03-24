import { getSocket, disconnectSocket } from "./socket";

const mockDisconnect = vi.fn();
const mockSocket = { disconnect: mockDisconnect };

vi.mock("socket.io-client", () => ({
  io: vi.fn(() => ({ ...mockSocket })),
}));

import { io } from "socket.io-client";

const mockedIo = vi.mocked(io);

beforeEach(() => {
  vi.resetAllMocks();
  mockedIo.mockReturnValue(mockSocket as unknown as ReturnType<typeof io>);
  disconnectSocket();
  // Clear counts after cleanup so tests start fresh
  mockDisconnect.mockClear();
  mockedIo.mockClear();
  localStorage.clear();
});

describe("getSocket", () => {
  it("creates socket with auth token from localStorage", () => {
    localStorage.setItem("token", "test-jwt");
    getSocket();

    expect(mockedIo).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: { token: "test-jwt" },
        reconnection: true,
      }),
    );
  });

  it("returns the same instance on repeated calls", () => {
    localStorage.setItem("token", "test-jwt");
    const s1 = getSocket();
    const s2 = getSocket();

    expect(s1).toBe(s2);
    expect(mockedIo).toHaveBeenCalledTimes(1);
  });

  it("recreates socket when token changes", () => {
    localStorage.setItem("token", "token-1");
    getSocket();

    localStorage.setItem("token", "token-2");
    getSocket();

    expect(mockedIo).toHaveBeenCalledTimes(2);
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });
});

describe("disconnectSocket", () => {
  it("disconnects and allows new socket creation", () => {
    localStorage.setItem("token", "test-jwt");
    getSocket();
    disconnectSocket();

    expect(mockDisconnect).toHaveBeenCalled();

    getSocket();
    expect(mockedIo).toHaveBeenCalledTimes(2);
  });
});
