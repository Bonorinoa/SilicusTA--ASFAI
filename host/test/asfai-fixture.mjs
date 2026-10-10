/** A connected AsfaiService over a mock ASFAI, for tests that drive the host end to end. */
import { startMockAsfai } from "./mock-asfai.mjs";
import { TokenStore } from "../asfai/tokens.mjs";
import { AsfaiOAuth } from "../asfai/oauth.mjs";
import { AsfaiClient } from "../asfai/mcp.mjs";
import { AsfaiService } from "../asfai/service.mjs";

export const ANSWERS = {
  topic: "how AI answers are built",
  course: "AI literacy, ages 8-10",
  learning_outcomes: ["Students can explain what an algorithm is.", "Learners can find the claim in an AI answer."],
};

export async function connectedAsfai(mockOpts = {}) {
  const mock = await startMockAsfai(mockOpts);
  const oauth = new AsfaiOAuth({
    prmUrl: mock.prmUrl, redirectUri: "http://127.0.0.1:8787/api/asfai/callback",
    tokenStore: new TokenStore(null), allowInsecure: true,
  });
  const { authorizeUrl } = await oauth.beginAuthorization();
  const { code, state } = mock.consent(authorizeUrl);
  await oauth.handleCallback({ code, state });
  return { mock, svc: new AsfaiService({ oauth, client: new AsfaiClient({ oauth, url: mock.mcpUrl }) }) };
}
