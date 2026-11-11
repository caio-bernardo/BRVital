// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { completeLogin, beginLogin } from "./auth";
const config = {
  domain: "https://example.auth.sa-east-1.amazoncognito.com",
  clientId: "public-client",
  redirectUri: "http://localhost:5173/",
};
afterEach(() => {
  sessionStorage.clear();
  vi.unstubAllGlobals();
});
test("recusa callback OAuth com estado divergente sem trocar código por token", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await beginLogin(config, () => {});
  await expect(completeLogin(config, "?code=abc&state=forged")).rejects.toThrow(
    /Sessão de acesso inválida/,
  );
  expect(fetcher).not.toHaveBeenCalled();
});
test("redirecionamento usa authorization code com PKCE S256, sem segredo", async () => {
  let target = "";
  await beginLogin(config, (url) => {
    target = url;
  });
  const url = new URL(target);
  expect(url.searchParams.get("response_type")).toBe("code");
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  expect(url.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(url.searchParams.has("client_secret")).toBe(false);
});
