import { it, expect, beforeAll, afterAll } from "vitest";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../server/app.js";
import { db, seal, unseal } from "../server/core.js";
import { ConfiguredAI, ConfiguredCodes } from "../server/providers.js";
import * as OTP from "otpauth";
let app: FastifyInstance;
let code = "";
let id = "";
let email = "";
const pw = "Verification-Secure123!";
const req = (path: string, body: any) =>
  app.inject({
    method: "POST",
    url: `/api/auth/${path}`,
    headers: { origin: "http://localhost:5173", "x-pl-request": "1" },
    payload: body,
  });
beforeAll(async () => {
  if (!process.env.DATABASE_URL?.includes("test"))
    throw new Error("Dedicated test database required");
  process.env.APP_ORIGIN = "http://localhost:5173";
  delete process.env.REDIS_URL;
  app = await buildApp({
    codes: {
      async send(_u, c) {
        code = c;
      },
    },
  });
  email = `verify-${randomUUID()}@example.test`;
  const r = await req("register", {
    name: "Verify User",
    username: `v_${randomUUID().slice(0, 8)}`,
    email,
    phone: `+17${Date.now().toString().slice(-10)}`,
    password: pw,
    confirmPassword: pw,
  });
  expect(r.statusCode).toBe(201);
  id = r.json().id;
});
afterAll(async () => {
  await app?.close();
  await db.$disconnect();
});
it("requires verification, prevents rapid resends and expires old codes", async () => {
  expect((await req("login", { login: email, password: pw })).statusCode).toBe(
    403,
  );
  expect((await req("resend", { login: email })).statusCode).toBe(429);
  await db.verification.update({
    where: { userId: id },
    data: { expiresAt: new Date(0) },
  });
  expect((await req("verify", { login: id, code })).statusCode).toBe(400);
  await db.verification.update({
    where: { userId: id },
    data: { sentAt: new Date(0) },
  });
  expect((await req("resend", { login: email })).statusCode).toBe(200);
  expect((await req("verify", { login: id, code: "000000" })).statusCode).toBe(
    400,
  );
  expect((await req("verify", { login: id, code })).statusCode).toBe(200);
  expect((await req("verify", { login: id, code })).statusCode).toBe(400);
});
it("rate-limits login attempts", async () => {
  for (let i = 0; i < 8; i++)
    await req("login", { login: "missing@example.test", password: "wrong" });
  expect(
    (await req("login", { login: "missing@example.test", password: "wrong" }))
      .statusCode,
  ).toBe(429);
});
it("fails closed when the verification provider is unconfigured", async () => {
  delete process.env.VERIFICATION_PROVIDER;
  await expect(
    new ConfiguredCodes().send(
      { email: "test@example.test", phone: "+12345678901" },
      "123456",
    ),
  ).rejects.toThrow("pas encore configuré");
});
it("calls an OpenAI-compatible HTTP provider and handles provider failure", async () => {
  let status = 200;
  let observed: any;
  const http = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      observed = {
        body: JSON.parse(body),
        auth: req.headers.authorization,
        path: req.url,
      };
      res.writeHead(status, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [{ message: { content: "HTTP adapter response" } }],
        }),
      );
    });
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const old = { ...process.env };
  process.env.AI_PROVIDER = "openai-compatible";
  process.env.AI_BASE_URL = `http://127.0.0.1:${(http.address() as any).port}/v1`;
  process.env.AI_MODEL = "test-model";
  process.env.AI_API_KEY = "test-only-local-fixture";
  try {
    expect(
      await new ConfiguredAI().complete([{ role: "user", content: "hello" }]),
    ).toBe("HTTP adapter response");
    expect(observed.path).toBe("/v1/chat/completions");
    expect(observed.body.model).toBe("test-model");
    expect(observed.body.max_completion_tokens).toBe(2048);
    expect(observed.body.max_tokens).toBeUndefined();
    expect(observed.auth).toBe("Bearer test-only-local-fixture");
    status = 503;
    await expect(new ConfiguredAI().complete([])).rejects.toThrow(
      "fournisseur IA",
    );
  } finally {
    await new Promise<void>((resolve) => http.close(() => resolve()));
    for (const key of [
      "AI_PROVIDER",
      "AI_BASE_URL",
      "AI_MODEL",
      "AI_API_KEY",
    ]) {
      if (old[key]) process.env[key] = old[key];
      else delete process.env[key];
    }
  }
});
it("encrypts TOTP secrets and rejects tampering", () => {
  process.env.TOTP_ENCRYPTION_KEY = "ab".repeat(32);
  const value = seal("JBSWY3DPEHPK3PXP");
  expect(value).not.toContain("JBSWY3DPEHPK3PXP");
  expect(unseal(value)).toBe("JBSWY3DPEHPK3PXP");
  const b = Buffer.from(value, "base64");
  b[15] ^= 1;
  expect(() => unseal(b.toString("base64"))).toThrow();
  delete process.env.TOTP_ENCRYPTION_KEY;
});
it("enrolls TOTP, requires it at login, changes passwords and anonymizes self-deletion", async () => {
  const fresh = await buildApp();
  process.env.TOTP_ENCRYPTION_KEY = "cd".repeat(32);
  async function call(method: any, path: string, body?: any, cookie?: string) {
    return fresh.inject({
      method,
      url: `/api${path}`,
      headers: {
        origin: "http://localhost:5173",
        "x-pl-request": "1",
        ...(cookie ? { cookie } : {}),
      },
      payload: body,
    });
  }
  try {
    const login = await call("POST", "/auth/login", {
      login: email,
      password: pw,
    });
    expect(login.statusCode).toBe(200);
    let cookie = login.headers["set-cookie"]!.toString().split(";")[0];
    const setup = await call("POST", "/security/2fa/setup", {}, cookie);
    expect(setup.statusCode).toBe(200);
    const otp = new OTP.TOTP({ secret: setup.json().secret });
    expect(
      (
        await call(
          "POST",
          "/security/2fa/confirm",
          { code: otp.generate() },
          cookie,
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (await call("POST", "/auth/login", { login: email, password: pw }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await call("POST", "/auth/login", {
          login: email,
          password: pw,
          otp: otp.generate(),
        })
      ).statusCode,
    ).toBe(200);
    const newPassword = "Changed-Password-Test123!";
    expect(
      (
        await call(
          "POST",
          "/security/password",
          { current: pw, password: newPassword },
          cookie,
        )
      ).statusCode,
    ).toBe(200);
    expect((await call("GET", "/me", undefined, cookie)).statusCode).toBe(401);
    const next = await call("POST", "/auth/login", {
      login: email,
      password: newPassword,
      otp: otp.generate(),
    });
    expect(next.statusCode).toBe(200);
    cookie = next.headers["set-cookie"]!.toString().split(";")[0];
    expect(
      (await call("DELETE", "/me", { password: newPassword }, cookie))
        .statusCode,
    ).toBe(200);
    expect((await call("GET", "/me", undefined, cookie)).statusCode).toBe(401);
    expect((await db.user.findUniqueOrThrow({ where: { id } })).status).toBe(
      "DELETED",
    );
  } finally {
    await fresh.close();
    delete process.env.TOTP_ENCRYPTION_KEY;
  }
});
