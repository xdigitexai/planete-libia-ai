import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { io as client, type Socket } from "socket.io-client";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../server/app.js";
import { db } from "../server/core.js";
import { ConfiguredAI } from "../server/providers.js";
let app: FastifyInstance;
let port: string;
const codes = new Map<string, string>();
const suffix = Date.now().toString();
const pw = "Test-only-Strong-Pass123!";
type Identity = {
  id: string;
  email: string;
  phone: string;
  username: string;
  cookie: string;
};
let alice: Identity,
  bob: Identity,
  eve: Identity,
  owner: Identity,
  roomId: string,
  groupId: string,
  threadId: string,
  articleId: string,
  mediaId: string;
const sockets: Socket[] = [];
function request(method: any, path: string, body?: any, cookie?: string) {
  return app.inject({
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
async function identity(name: string) {
  const data = {
    name,
    username: `${name.toLowerCase()}_${suffix}`,
    email: `${name}.${suffix}@example.test`,
    phone: `+${name === "Alice" ? 111 : name === "Bob" ? 112 : name === "Eve" ? 113 : 114}${suffix.slice(-9)}`,
    password: pw,
    confirmPassword: pw,
  };
  const reg = await request("POST", "/auth/register", data);
  expect(reg.statusCode).toBe(201);
  const id = reg.json().id;
  expect(
    (
      await request("POST", "/auth/verify", {
        login: id,
        code: codes.get(data.email.toLowerCase()),
      })
    ).statusCode,
  ).toBe(200);
  const login = await request("POST", "/auth/login", {
    login: data.email,
    password: pw,
  });
  expect(login.statusCode).toBe(200);
  return {
    ...data,
    id,
    cookie: login.headers["set-cookie"]!.toString().split(";")[0],
  };
}
beforeAll(async () => {
  if (!process.env.DATABASE_URL?.includes("test"))
    throw new Error("Use a dedicated database with test in DATABASE_URL.");
  process.env.APP_ORIGIN = "http://localhost:5173";
  delete process.env.REDIS_URL;
  app = await buildApp({
    codes: {
      async send(u, c) {
        codes.set(u.email, c);
      },
    },
    ai: {
      async complete(m) {
        return `Test provider response: ${m.at(-1)!.content}`;
      },
    },
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  port = `http://127.0.0.1:${(app.server.address() as any).port}`;
  alice = await identity("Alice");
  bob = await identity("Bob");
  eve = await identity("Eve");
  owner = await identity("Owner");
  await db.user.update({ where: { id: owner.id }, data: { role: "ADMIN" } });
});
afterAll(async () => {
  sockets.forEach((s) => s.disconnect());
  await app?.close();
  await db.$disconnect();
});
describe.sequential(
  "Database-backed access boundaries and feature flows",
  () => {
    it("rejects unauthenticated and cross-origin operations", async () => {
      expect((await request("GET", "/me")).statusCode).toBe(401);
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/groups",
            headers: {
              cookie: alice.cookie,
              origin: "https://evil.invalid",
              "x-pl-request": "1",
            },
            payload: { name: "No" },
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/groups",
            headers: { cookie: alice.cookie, origin: "http://localhost:5173" },
            payload: { name: "No" },
          })
        ).statusCode,
      ).toBe(403);
    });
    it("enforces all unique identifiers and strong password policy", async () => {
      for (const field of ["email", "phone", "username"]) {
        const data = {
          name: "Duplicate",
          username: `dupe_${randomUUID().slice(0, 8)}`,
          email: `${randomUUID()}@example.test`,
          phone: "+199900012345",
          password: pw,
          confirmPassword: pw,
          [field]: alice[field as keyof Identity],
        };
        expect((await request("POST", "/auth/register", data)).statusCode).toBe(
          409,
        );
      }
      expect(
        (
          await request("POST", "/auth/register", {
            name: "Weak",
            username: "weak",
            email: "weak@example.test",
            phone: "+19876543210",
            password: "abc",
            confirmPassword: "abc",
          })
        ).statusCode,
      ).toBe(400);
    });
    it("stores password hashes and excludes secrets from profile output", async () => {
      const u = await db.user.findUniqueOrThrow({ where: { id: alice.id } });
      expect(u.passwordHash).not.toBe(pw);
      const me = await request("GET", "/me", undefined, alice.cookie);
      expect(me.json().passwordHash).toBeUndefined();
      expect(me.json().totpSecret).toBeUndefined();
    });
    it("rejects invalid login and records session cookie protections", async () => {
      expect(
        (
          await request("POST", "/auth/login", {
            login: alice.email,
            password: "wrong",
          })
        ).statusCode,
      ).toBe(401);
      const r = await request("POST", "/auth/login", {
        login: alice.username,
        password: pw,
      });
      expect(r.headers["set-cookie"]).toContain("HttpOnly");
      expect(r.headers["set-cookie"]).toContain("SameSite=Lax");
    });
    it("creates isolated AI history with configured provider and deletion authorization", async () => {
      const t = await request("POST", "/ai/threads", {}, alice.cookie);
      threadId = t.json().id;
      expect(
        (
          await request(
            "POST",
            `/ai/threads/${threadId}/messages`,
            { content: "Bonjour" },
            alice.cookie,
          )
        ).json().messages,
      ).toHaveLength(2);
      expect(
        (await request("GET", `/ai/threads/${threadId}`, undefined, eve.cookie))
          .statusCode,
      ).toBe(404);
      expect(
        (
          await request(
            "DELETE",
            `/ai/threads/${threadId}`,
            undefined,
            eve.cookie,
          )
        ).statusCode,
      ).toBe(404);
      expect(
        (
          await request(
            "POST",
            `/ai/threads/${threadId}/messages`,
            { content: "Steal" },
            eve.cookie,
          )
        ).statusCode,
      ).toBe(404);
    });
    it("reports unconfigured AI honestly", async () => {
      delete process.env.AI_PROVIDER;
      await expect(
        new ConfiguredAI().complete([{ role: "user", content: "hello" }]),
      ).rejects.toThrow("pas encore configuré");
    });
    it("creates a private room, sends idempotently, counts unread, records receipts", async () => {
      roomId = (
        await request(
          "POST",
          "/rooms/private",
          { userId: bob.id },
          alice.cookie,
        )
      ).json().id;
      const body = { body: "Bonjour Bob", clientId: randomUUID() };
      const first = await request(
        "POST",
        `/rooms/${roomId}/messages`,
        body,
        alice.cookie,
      );
      expect(first.statusCode).toBe(200);
      expect(
        (
          await request("POST", `/rooms/${roomId}/messages`, body, alice.cookie)
        ).json().id,
      ).toBe(first.json().id);
      expect(
        (await request("GET", "/rooms", undefined, bob.cookie))
          .json()
          .find((r: any) => r.id === roomId).unread,
      ).toBe(1);
      expect(
        (await request("POST", `/rooms/${roomId}/delivered`, {}, bob.cookie))
          .statusCode,
      ).toBe(200);
      expect(
        (await request("POST", `/rooms/${roomId}/read`, {}, bob.cookie))
          .statusCode,
      ).toBe(200);
      expect(
        (await request("GET", "/rooms", undefined, bob.cookie))
          .json()
          .find((r: any) => r.id === roomId).unread,
      ).toBe(0);
    });
    it("rejects room and receipt IDOR", async () => {
      for (const [method, path, body] of [
        ["GET", `/rooms/${roomId}/messages`, undefined],
        ["POST", `/rooms/${roomId}/read`, {}],
        [
          "POST",
          `/rooms/${roomId}/messages`,
          { body: "attack", clientId: randomUUID() },
        ],
      ])
        expect(
          (await request(method, path as string, body, eve.cookie)).statusCode,
        ).toBe(404);
    });
    it("creates groups and enforces owner and administrator permissions", async () => {
      groupId = (
        await request("POST", "/groups", { name: "Test group" }, alice.cookie)
      ).json().id;
      expect(
        (
          await request(
            "POST",
            `/groups/${groupId}/members`,
            { userId: bob.id },
            alice.cookie,
          )
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await request(
            "POST",
            `/groups/${groupId}/members`,
            { userId: eve.id },
            bob.cookie,
          )
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await request(
            "PATCH",
            `/groups/${groupId}`,
            { name: "Takeover" },
            bob.cookie,
          )
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await request(
            "DELETE",
            `/groups/${groupId}/members/${alice.id}`,
            undefined,
            bob.cookie,
          )
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await request(
            "POST",
            `/rooms/${groupId}/messages`,
            { body: "Bonjour groupe", clientId: randomUUID() },
            bob.cookie,
          )
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await request(
            "DELETE",
            `/groups/${groupId}/members/${bob.id}`,
            undefined,
            alice.cookie,
          )
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await request(
            "GET",
            `/rooms/${groupId}/messages`,
            undefined,
            bob.cookie,
          )
        ).statusCode,
      ).toBe(404);
    });
    it("enforces notification ownership and preferences", async () => {
      const list = (
        await request("GET", "/notifications", undefined, bob.cookie)
      ).json();
      expect(list.unread).toBeGreaterThan(0);
      expect(
        (
          await request(
            "POST",
            `/notifications/${list.items[0].id}/read`,
            {},
            eve.cookie,
          )
        ).statusCode,
      ).toBe(404);
      expect(
        (
          await request(
            "POST",
            `/notifications/${list.items[0].id}/read`,
            {},
            bob.cookie,
          )
        ).statusCode,
      ).toBe(200);
      await request(
        "PATCH",
        "/me",
        { preferences: { messages: false } },
        bob.cookie,
      );
      const before = await db.notification.count({ where: { userId: bob.id } });
      await request(
        "POST",
        `/rooms/${roomId}/messages`,
        { body: "Quiet", clientId: randomUUID() },
        alice.cookie,
      );
      expect(await db.notification.count({ where: { userId: bob.id } })).toBe(
        before,
      );
    });
    it("respects blocking in discovery and existing messages", async () => {
      expect(
        (await request("POST", `/blocks/${alice.id}`, {}, bob.cookie))
          .statusCode,
      ).toBe(200);
      expect(
        (await request("GET", `/users/${alice.id}`, undefined, bob.cookie))
          .statusCode,
      ).toBe(404);
      expect(
        (
          await request(
            "POST",
            `/rooms/${roomId}/messages`,
            { body: "blocked", clientId: randomUUID() },
            alice.cookie,
          )
        ).statusCode,
      ).toBe(403);
      expect(
        (await request("DELETE", `/blocks/${alice.id}`, undefined, bob.cookie))
          .statusCode,
      ).toBe(200);
      expect(
        (await request("POST", `/contacts/${alice.id}`, {}, bob.cookie))
          .statusCode,
      ).toBe(200);
    });
    it("denies every administration list and protects draft publications", async () => {
      for (const path of [
        "stats",
        "users",
        "groups",
        "news",
        "reports",
        "settings",
        "audit",
      ])
        expect(
          (await request("GET", `/admin/${path}`, undefined, alice.cookie))
            .statusCode,
        ).toBe(403);
      const c = await db.category.upsert({
        where: { name: "Test category" },
        create: { name: "Test category" },
        update: {},
      });
      const b = {
        title: "Test publication",
        summary: "A factual test summary",
        content: "A complete test article body.",
        categoryId: c.id,
        published: false,
      };
      expect(
        (await request("POST", "/admin/news", b, alice.cookie)).statusCode,
      ).toBe(403);
      articleId = (await request("POST", "/admin/news", b, owner.cookie)).json()
        .id;
      expect((await request("GET", `/news/${articleId}`)).statusCode).toBe(404);
      expect(
        (
          await request(
            "PATCH",
            `/admin/news/${articleId}`,
            { ...b, published: true },
            owner.cookie,
          )
        ).statusCode,
      ).toBe(200);
      expect((await request("GET", `/news/${articleId}`)).statusCode).toBe(200);
      expect(
        (await request("GET", "/news?q=Test%20publication"))
          .json()
          .some((a: any) => a.id === articleId),
      ).toBe(true);
      expect(
        (
          await request(
            "DELETE",
            `/admin/news/${articleId}`,
            undefined,
            owner.cookie,
          )
        ).statusCode,
      ).toBe(200);
      expect(
        await db.auditLog.count({ where: { actorId: owner.id } }),
      ).toBeGreaterThan(0);
    });
    it("stores an admin OpenAI key encrypted and never returns it", async () => {
      const previous = process.env.TOTP_ENCRYPTION_KEY;
      const previousSetting = await db.setting.findUnique({ where: { key: "_secret.openai" } });
      process.env.TOTP_ENCRYPTION_KEY = "7a".repeat(32);
      const secret = "sk-test-admin-secret-that-must-not-leak";
      try {
        expect((await request("PUT", "/admin/ai-config", { apiKey: secret }, alice.cookie)).statusCode).toBe(403);
        expect((await request("PUT", "/admin/ai-config", { apiKey: secret }, owner.cookie)).statusCode).toBe(200);
        const stored = await db.setting.findUniqueOrThrow({ where: { key: "_secret.openai" } });
        expect(JSON.stringify(stored.value)).not.toContain(secret);
        expect((await request("GET", "/admin/ai-config", undefined, owner.cookie)).json()).toMatchObject({ configured: true, source: "admin" });
        expect(JSON.stringify((await request("GET", "/admin/settings", undefined, owner.cookie)).json())).not.toContain("_secret.openai");
        expect((await request("DELETE", "/admin/ai-config", undefined, owner.cookie)).statusCode).toBe(200);
      } finally {
        if (previousSetting)
          await db.setting.upsert({
            where: { key: "_secret.openai" },
            create: { key: "_secret.openai", value: previousSetting.value },
            update: { value: previousSetting.value },
          });
        else await db.setting.deleteMany({ where: { key: "_secret.openai" } });
        if (previous) process.env.TOTP_ENCRYPTION_KEY = previous;
        else delete process.env.TOTP_ENCRYPTION_KEY;
      }
    });
    it("validates uploads by bytes and isolates private files", async () => {
      const boundary = "test-boundary";
      async function put(data: Buffer, name: string, mime: string) {
        return app.inject({
          method: "POST",
          url: "/api/media",
          headers: {
            origin: "http://localhost:5173",
            "x-pl-request": "1",
            cookie: alice.cookie,
            "content-type": `multipart/form-data; boundary=${boundary}`,
          },
          payload: Buffer.concat([
            Buffer.from(
              `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${mime}\r\n\r\n`,
            ),
            data,
            Buffer.from(`\r\n--${boundary}--\r\n`),
          ]),
        });
      }
      expect(
        (
          await put(
            Buffer.from("<script>alert(1)</script>"),
            "evil.png",
            "image/png",
          )
        ).statusCode,
      ).toBe(415);
      const png = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
        "base64",
      );
      const r = await put(png, "photo.png", "image/png");
      expect(r.statusCode).toBe(200);
      mediaId = r.json().id;
      expect(
        (await request("GET", `/media/${mediaId}`, undefined, eve.cookie))
          .statusCode,
      ).toBe(404);
      expect(
        (await request("GET", `/media/${mediaId}`, undefined, alice.cookie))
          .statusCode,
      ).toBe(200);
      expect(
        (
          await request(
            "POST",
            `/rooms/${roomId}/messages`,
            { body: "Photo", clientId: randomUUID(), mediaId },
            alice.cookie,
          )
        ).statusCode,
      ).toBe(200);
      expect(
        (await request("GET", `/media/${mediaId}`, undefined, bob.cookie))
          .statusCode,
      ).toBe(200);
    });
    it("connects real WebSockets, sends typing, delivers messages and tests call lifecycle", async () => {
      async function connect(who: Identity) {
        const s = client(port, {
          transports: ["websocket"],
          extraHeaders: { origin: "http://localhost:5173", cookie: who.cookie },
          forceNew: true,
        });
        sockets.push(s);
        await new Promise<void>((resolve, reject) => {
          s.on("connect", resolve);
          s.on("connect_error", reject);
        });
        return s;
      }
      const a = await connect(alice),
        b = await connect(bob),
        e = await connect(eve);
      const typing = new Promise<any>((resolve) => b.once("typing", resolve));
      a.emit("typing", { roomId, typing: true });
      expect((await typing).userId).toBe(alice.id);
      const denied = await new Promise<any>((resolve) =>
        e.emit("typing", { roomId, typing: true }, resolve),
      );
      expect(denied.error).toBeTruthy();
      const received = new Promise<any>((resolve) =>
        b.once("message", resolve),
      );
      await request(
        "POST",
        `/rooms/${roomId}/messages`,
        { body: "Live websocket", clientId: randomUUID() },
        alice.cookie,
      );
      expect((await received).body).toBe("Live websocket");
      const c = (
        await request("POST", "/calls", { roomId, video: false }, alice.cookie)
      ).json();
      expect(c.state).toBe("RINGING");
      expect(
        (
          await request(
            "POST",
            `/calls/${c.id}/state`,
            { state: "ACCEPTED" },
            eve.cookie,
          )
        ).statusCode,
      ).toBe(404);
      expect(
        (
          await request(
            "POST",
            `/calls/${c.id}/state`,
            { state: "ACCEPTED" },
            alice.cookie,
          )
        ).statusCode,
      ).toBe(409);
      expect(
        (
          await request(
            "POST",
            `/calls/${c.id}/state`,
            { state: "ACCEPTED" },
            bob.cookie,
          )
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await request(
            "POST",
            `/calls/${c.id}/connected`,
            {},
            alice.cookie,
          )
        ).json().state,
      ).toBe("CONNECTED");
      expect(
        (
          await request("GET", `/rooms/${roomId}/calls`, undefined, bob.cookie)
        ).json().some((call: any) => call.id === c.id),
      ).toBe(true);
      expect(
        (await request("GET", `/rooms/${roomId}/calls`, undefined, eve.cookie))
          .statusCode,
      ).toBe(404);
      const signal = new Promise<any>((resolve) => b.once("signal", resolve));
      a.emit("signal", {
        callId: c.id,
        type: "offer",
        data: { type: "offer", sdp: "test-signaling-payload" },
      });
      expect((await signal).callId).toBe(c.id);
      const unauthorized = await new Promise<any>((resolve) =>
        e.emit("signal", { callId: c.id, type: "ice", data: {} }, resolve),
      );
      expect(unauthorized.error).toBeTruthy();
      expect(
        (
          await request(
            "POST",
            `/calls/${c.id}/state`,
            { state: "ENDED" },
            alice.cookie,
          )
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await request(
            "POST",
            `/calls/${c.id}/state`,
            { state: "ACCEPTED" },
            bob.cookie,
          )
        ).statusCode,
      ).toBe(409);
    });
    it("manages reports, settings, group moderation and administrative audit", async () => {
      const report = await request(
        "POST",
        "/reports",
        {
          targetType: "GROUP",
          targetId: groupId,
          reason: "A report submitted during security testing.",
        },
        alice.cookie,
      );
      expect(report.statusCode).toBe(200);
      expect(
        (
          await request(
            "PATCH",
            `/admin/reports/${report.json().id}`,
            {
              state: "RESOLVED",
              resolution: "Reviewed by test administrator.",
            },
            owner.cookie,
          )
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await request(
            "PUT",
            "/admin/settings",
            { key: "announcement", value: "Test announcement" },
            owner.cookie,
          )
        ).statusCode,
      ).toBe(200);
      expect(
        (await request("GET", "/content"))
          .json()
          .some((s: any) => s.key === "announcement"),
      ).toBe(true);
      expect(
        (
          await request(
            "PATCH",
            `/admin/groups/${groupId}`,
            { locked: true },
            owner.cookie,
          )
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await request(
            "POST",
            `/rooms/${groupId}/messages`,
            { body: "Locked", clientId: randomUUID() },
            alice.cookie,
          )
        ).statusCode,
      ).toBe(403);
      expect(
        (await request("GET", "/admin/audit", undefined, owner.cookie)).json()
          .length,
      ).toBeGreaterThan(0);
    });
    it("suspends users, revokes their sessions and prevents deleting administrators", async () => {
      expect(
        (
          await request(
            "PATCH",
            `/admin/users/${bob.id}`,
            { status: "SUSPENDED" },
            alice.cookie,
          )
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await request(
            "PATCH",
            `/admin/users/${bob.id}`,
            { status: "SUSPENDED" },
            owner.cookie,
          )
        ).statusCode,
      ).toBe(200);
      expect(
        (await request("GET", "/me", undefined, bob.cookie)).statusCode,
      ).toBe(401);
      expect(
        (
          await request(
            "PATCH",
            `/admin/users/${bob.id}`,
            { status: "ACTIVE" },
            owner.cookie,
          )
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await request(
            "DELETE",
            `/admin/users/${owner.id}`,
            undefined,
            owner.cookie,
          )
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await request(
            "DELETE",
            `/admin/users/${bob.id}`,
            undefined,
            owner.cookie,
          )
        ).statusCode,
      ).toBe(200);
      expect(
        (await db.user.findUniqueOrThrow({ where: { id: bob.id } })).email,
      ).toContain("@deleted.invalid");
    });
    it("rejects profile privilege escalation and push when unconfigured", async () => {
      expect(
        (
          await request(
            "PATCH",
            "/me",
            { role: "ADMIN", name: "Alice Updated" },
            alice.cookie,
          )
        ).statusCode,
      ).toBe(200);
      expect(
        (await db.user.findUniqueOrThrow({ where: { id: alice.id } })).role,
      ).toBe("USER");
      expect(
        (await request("GET", "/push/config", undefined, alice.cookie)).json()
          .configured,
      ).toBe(false);
      expect(
        (
          await request(
            "POST",
            "/push/subscribe",
            {
              endpoint: "https://localhost/secret",
              keys: { p256dh: "x", auth: "x" },
            },
            alice.cookie,
          )
        ).statusCode,
      ).toBe(503);
      expect(
        (await request("DELETE", "/me", { password: "wrong" }, alice.cookie))
          .statusCode,
      ).toBe(403);
    });
    it("revokes sessions immediately on logout", async () => {
      expect(
        (await request("POST", "/auth/logout", {}, eve.cookie)).statusCode,
      ).toBe(200);
      expect(
        (await request("GET", "/me", undefined, eve.cookie)).statusCode,
      ).toBe(401);
    });
  },
);
