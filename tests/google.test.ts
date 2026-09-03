import { it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } from "jose";
import { verifyGoogleIdToken } from "../server/google.js";
import { buildApp } from "../server/app.js";
import { db } from "../server/core.js";
it("validates signed Google ID-token claims and nonce", async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  jwk.kid = "test-key";
  const keys = createLocalJWKSet({ keys: [jwk] });
  const nonce = "test-nonce";
  process.env.GOOGLE_CLIENT_ID = "test-google-client";
  const raw = await new SignJWT({
    email: "person@example.test",
    email_verified: true,
    name: "Google Person",
    nonce,
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer("https://accounts.google.com")
    .setAudience(process.env.GOOGLE_CLIENT_ID)
    .setSubject("google-subject")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
  expect((await verifyGoogleIdToken(raw, nonce, keys)).subject).toBe(
    "google-subject",
  );
  await expect(verifyGoogleIdToken(raw, "wrong", keys)).rejects.toThrow(
    "non vérifiée",
  );
  delete process.env.GOOGLE_CLIENT_ID;
});
it("completes state/PKCE Google signup with a provider fixture and creates a session", async () => {
  const oldId = process.env.GOOGLE_CLIENT_ID,
    oldSecret = process.env.GOOGLE_CLIENT_SECRET,
    oldOrigin = process.env.APP_ORIGIN;
  process.env.APP_ORIGIN = "http://localhost:5173";
  process.env.GOOGLE_CLIENT_ID = "local-test-client";
  process.env.GOOGLE_CLIENT_SECRET = "local-test-secret-never-live";
  const email = `google-${randomUUID()}@example.test`;
  const app = await buildApp({
    google: {
      async exchange(code, verifier, nonce) {
        expect(code).toBe("one-time-code");
        expect(verifier.length).toBeGreaterThan(30);
        expect(nonce.length).toBeGreaterThan(30);
        return { subject: `subject-${email}`, email, name: "Google Test" };
      },
    },
  });
  const headers = (cookie?: string) => ({
    origin: "http://localhost:5173",
    "x-pl-request": "1",
    ...(cookie ? { cookie } : {}),
  });
  try {
    const start = await app.inject({
      method: "POST",
      url: "/api/auth/google/start",
      headers: headers(),
      payload: {},
    });
    expect(start.statusCode).toBe(200);
    const flow = start.headers["set-cookie"]!.toString().split(";")[0];
    const state = new URL(start.json().url).searchParams.get("state")!;
    const callback = await app.inject({
      method: "GET",
      url: `/api/auth/google/callback?state=${encodeURIComponent(state)}&code=one-time-code`,
      headers: { cookie: flow },
    });
    expect(callback.statusCode).toBe(302);
    const pending = [callback.headers["set-cookie"]]
      .flat()
      .map(String)
      .find((c) => c.startsWith("pl_google_pending="))!
      .split(";")[0];
    const finish = await app.inject({
      method: "POST",
      url: "/api/auth/google/complete",
      headers: headers(pending),
      payload: {
        name: "Google Test",
        username: `google_${randomUUID().slice(0, 8)}`,
        phone: `+15${Date.now().toString().slice(-10)}`,
      },
    });
    expect(finish.statusCode).toBe(200);
    const session = [finish.headers["set-cookie"]]
      .flat()
      .map(String)
      .find((c) => c.startsWith("pl_session="))!
      .split(";")[0];
    const me = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: { cookie: session },
    });
    expect(me.json()).toMatchObject({
      email,
      googleLinked: true,
      passwordLogin: false,
    });
  } finally {
    await app.close();
    await db.user.deleteMany({ where: { email } });
    if (oldId) process.env.GOOGLE_CLIENT_ID = oldId;
    else delete process.env.GOOGLE_CLIENT_ID;
    if (oldSecret) process.env.GOOGLE_CLIENT_SECRET = oldSecret;
    else delete process.env.GOOGLE_CLIENT_SECRET;
    if (oldOrigin) process.env.APP_ORIGIN = oldOrigin;
    else delete process.env.APP_ORIGIN;
  }
});
