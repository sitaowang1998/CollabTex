export async function apiFetch<ResponseType>(
  url: string,
  options: {
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    token?: string;
    body?: unknown;
  } = {},
): Promise<ResponseType> {
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.token
        ? {
            Authorization: `Bearer ${options.token}`,
          }
        : {}),
    },
    ...(options.body === undefined
      ? {}
      : {
          body: JSON.stringify(options.body),
        }),
  });

  if (!response.ok) {
    const message = await readErrorMessage(response);
    throw new Error(message);
  }

  if (response.status === 204) {
    return undefined as ResponseType;
  }

  return (await response.json()) as ResponseType;
}

async function readErrorMessage(response: Response) {
  try {
    const body = (await response.json()) as {
      error?: string;
      message?: string;
    };
    return (
      body.error ?? body.message ?? `Request failed with ${response.status}`
    );
  } catch {
    return `Request failed with ${response.status}`;
  }
}

export function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Something went wrong.";
}
