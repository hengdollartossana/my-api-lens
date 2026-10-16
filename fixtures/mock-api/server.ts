import { createMockServer } from "./app";
import { mockApiPort } from "./base-url";

const port = mockApiPort();
createMockServer().listen(port, () => {
  console.log(`mock api listening on http://localhost:${port}`);
});
