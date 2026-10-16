/** Base URL of the local mock API, from MOCK_API_PORT (default 4010). */
export function mockApiPort(env: Record<string, string | undefined> = process.env): number {
  return Number(env.MOCK_API_PORT) || 4010;
}

export function mockBaseUrl(env: Record<string, string | undefined> = process.env): string {
  return `http://localhost:${mockApiPort(env)}`;
}
