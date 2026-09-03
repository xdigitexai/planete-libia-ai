import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
const db = new PrismaClient();
const email = `browser-${Date.now()}@example.test`;
const password = "Browser-Test-Secure123!";
test.beforeAll(async () => {
  if (!process.env.DATABASE_URL?.includes("test"))
    throw new Error("Dedicated test database required.");
  await db.user.create({
    data: {
      name: "Test Navigateur",
      username: `browser_${Date.now()}`,
      email,
      phone: `+16${Date.now().toString().slice(-10)}`,
      passwordHash: await bcrypt.hash(password, 12),
      verifiedAt: new Date(),
    },
  });
});
test.afterAll(async () => {
  await db.$disconnect();
});
test("landing, login, dashboard, group, settings and AI error integrate without overflow", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /Le savoir nous rapproche/ }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.goto("/connexion");
  await page.getByLabel("E-mail, téléphone ou nom d’utilisateur").fill(email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await expect(page).toHaveURL(/accueil/);
  await expect(
    page.getByRole("heading", { name: "Bienvenue, Test." }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/dashboard-${info.project.name}.png`,
    fullPage: true,
  });
  await page.goto("/groupes/nouveau");
  await page
    .getByLabel("Nom du groupe")
    .fill(`Groupe navigateur ${info.project.name}`);
  await page
    .getByLabel("Description", { exact: true })
    .fill("Créé pendant un test de navigateur.");
  await page
    .getByRole("button", { name: "Créer le groupe", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Informations du groupe" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Ouvrir la discussion" }).click();
  await page
    .getByRole("textbox", { name: "Votre message" })
    .fill("Bonjour depuis le navigateur");
  await page.getByRole("button", { name: "Envoyer", exact: true }).click();
  await expect(
    page.getByText("Bonjour depuis le navigateur", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.goto("/ia");
  await page
    .getByRole("textbox", { name: "Votre demande à l’IA" })
    .fill("Bonjour");
  await page.getByRole("button", { name: "Envoyer à l’IA" }).click();
  await expect(page.getByRole("alert")).toContainText("pas encore configuré");
  await page.goto("/parametres");
  await page.getByLabel("Thème").selectOption("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByLabel("Thème").selectOption("dark");
  await page.goto("/actualites");
  await expect(
    page.getByRole("heading", { name: "Actualités", exact: true }),
  ).toBeVisible();
  await page.goto("/a-propos");
  await expect(
    page.getByText("Fils de José LIBIA et Martine Yetene."),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test("protected route redirects anonymous visitors", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/connexion/);
});
test("registration explains invalid fields and Google configuration", async ({
  page,
}) => {
  await page.goto("/inscription");
  await page.getByLabel("Nom et prénom").fill("J");
  await page.locator('input[name="username"]').fill("José Libia");
  await page.locator('input[name="phone"]').fill("081234");
  await page.getByLabel("Adresse e-mail").fill("person@example.test");
  await page.locator('input[name="password"]').fill("simple");
  await page.getByLabel("Confirmation du mot de passe").fill("different");
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await expect(
    page.getByText("Indiquez au moins 2 caractères pour votre nom."),
  ).toBeVisible();
  await expect(
    page.getByText(/Utilisez 3 à 30 lettres sans accent/),
  ).toBeVisible();
  await expect(page.getByText(/Ajoutez \+ et l’indicatif/)).toBeVisible();
  await expect(page.getByText(/au moins 12 caractères/).last()).toBeVisible();
  await page.getByRole("button", { name: "Continuer avec Google" }).click();
  await expect(
    page.getByText(/Google n’est pas encore configurée/),
  ).toBeVisible();
});
test("administrator tabs and publishing work across data shapes", async ({
  page,
}) => {
  await db.user.update({ where: { email }, data: { role: "ADMIN" } });
  await page.goto("/connexion");
  await page.getByLabel("E-mail, téléphone ou nom d’utilisateur").fill(email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await expect(page).toHaveURL(/accueil/);
  await page.goto("/admin");
  await expect(
    page.getByRole("heading", { name: "Administration", exact: true }),
  ).toBeVisible();
  for (const name of [
    "Utilisateurs",
    "Groupes",
    "Signalements",
    "Configuration",
    "Journal d’audit",
    "Publications",
  ]) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Administration", exact: true }),
    ).toBeVisible();
  }
  await page
    .getByRole("button", { name: "Nouvel article", exact: true })
    .click();
  await page
    .getByLabel("Titre", { exact: true })
    .fill("Publication navigateur");
  await page
    .getByLabel("Résumé", { exact: true })
    .fill("Vérification de publication depuis le navigateur.");
  await page
    .getByLabel("Contenu", { exact: true })
    .fill("Ce contenu a été créé pendant le test complet de publication.");
  await page.getByLabel("Publier", { exact: true }).check();
  await page.getByRole("button", { name: "Enregistrer l’article" }).click();
  await expect(page.getByText("Publication navigateur").first()).toBeVisible();
});
