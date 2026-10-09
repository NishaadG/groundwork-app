"use client";

import { createCognitoClient } from "./cognito";
import { createMockClient } from "./mock";
import type { AuthClient } from "./types";

export * from "./types";

let client: AuthClient | null = null;

export function authClient(): AuthClient {
  client ??=
    process.env.NEXT_PUBLIC_AUTH_MODE === "mock" ? createMockClient() : createCognitoClient();
  return client;
}
