import nodemailer from "nodemailer";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { fail, storedOpenAiKey } from "./core.js";
export interface AIProvider {
  complete(messages: { role: string; content: string }[]): Promise<string>;
}
export class ConfiguredAI implements AIProvider {
  async complete(messages: { role: string; content: string }[]) {
    const apiKey = process.env.AI_API_KEY || (await storedOpenAiKey());
    if (
      process.env.AI_PROVIDER !== "openai-compatible" ||
      !apiKey ||
      !process.env.AI_MODEL ||
      !process.env.AI_BASE_URL
    )
      return fail(503, "Le service IA n’est pas encore configuré.");
    let response: Response;
    try {
      response = await fetch(
        `${process.env.AI_BASE_URL.replace(/\/$/, "")}/chat/completions`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: process.env.AI_MODEL,
            messages,
            max_completion_tokens: 2048,
          }),
          signal: AbortSignal.timeout(60000),
        },
      );
    } catch {
      return fail(
        502,
        "Le service IA est temporairement indisponible. Réessayez.",
      );
    }
    if (!response.ok) {
      if (response.status === 401)
        return fail(502, "La clé API OpenAI est invalide ou a été révoquée.");
      if (response.status === 403)
        return fail(502, "Cette clé OpenAI n’a pas accès au modèle configuré.");
      if (response.status === 429)
        return fail(502, "Le quota ou la limite de requêtes OpenAI est atteint.");
      if (response.status === 400)
        return fail(502, "La configuration de la requête OpenAI est invalide.");
      return fail(502, "Le fournisseur IA n’a pas pu répondre.");
    }
    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return (
      data.choices?.[0]?.message?.content || fail(502, "Réponse IA invalide.")
    );
  }
}
export interface CodeProvider {
  send(user: { email: string; phone: string }, code: string): Promise<void>;
}
export class ConfiguredCodes implements CodeProvider {
  async send(user: { email: string; phone: string }, code: string) {
    if (
      process.env.VERIFICATION_PROVIDER === "smtp" &&
      process.env.SMTP_URL &&
      process.env.MAIL_FROM
    ) {
      try {
        await nodemailer.createTransport(process.env.SMTP_URL).sendMail({
          from: process.env.MAIL_FROM,
          to: user.email,
          subject: "Vérification PLANÈTE LIBIA AI",
          text: `Votre code : ${code}. Il expire dans 10 minutes.`,
        });
        return;
      } catch {
        fail(502, "Envoi du code impossible. Réessayez.");
      }
    }
    if (
      process.env.VERIFICATION_PROVIDER === "twilio" &&
      process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_FROM
    ) {
      const sid = process.env.TWILIO_ACCOUNT_SID;
      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            To: user.phone,
            From: process.env.TWILIO_FROM,
            Body: `PLANÈTE LIBIA AI : ${code}. Valable 10 minutes.`,
          }),
          signal: AbortSignal.timeout(15000),
        },
      );
      if (!res.ok) fail(502, "Envoi SMS impossible.");
      return;
    }
    fail(503, "Le service de vérification n’est pas encore configuré.");
  }
}
export class Storage {
  private client() {
    if (!process.env.S3_BUCKET) fail(503, "Stockage S3 non configuré.");
    return new S3Client({
      region: process.env.S3_REGION || "us-east-1",
      endpoint: process.env.S3_ENDPOINT,
      forcePathStyle: true,
    });
  }
  async put(key: string, data: Buffer, mime: string) {
    if (process.env.STORAGE_PROVIDER === "s3") {
      await this.client().send(
        new PutObjectCommand({
          Bucket: process.env.S3_BUCKET,
          Key: key,
          Body: data,
          ContentType: mime,
        }),
      );
    } else {
      const dir = path.resolve(process.env.UPLOAD_DIR || "data/uploads");
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, key), data, { flag: "wx" });
    }
  }
  async get(key: string) {
    if (process.env.STORAGE_PROVIDER === "s3") {
      const r = await this.client().send(
        new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }),
      );
      return Buffer.from(await r.Body!.transformToByteArray());
    }
    return readFile(
      path.resolve(process.env.UPLOAD_DIR || "data/uploads", key),
    );
  }
  async remove(key: string) {
    if (process.env.STORAGE_PROVIDER === "s3")
      await this.client().send(
        new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }),
      );
    else
      await unlink(
        path.resolve(process.env.UPLOAD_DIR || "data/uploads", key),
      ).catch(() => {});
  }
}
