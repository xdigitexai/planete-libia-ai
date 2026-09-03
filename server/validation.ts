import { z } from "zod";
export const profileFields = {
  name: z
    .string()
    .trim()
    .min(2, "Indiquez au moins 2 caractères pour votre nom.")
    .max(80, "Votre nom doit contenir au maximum 80 caractères."),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      /^[a-z0-9_]{3,30}$/,
      "Utilisez 3 à 30 lettres sans accent, chiffres ou tirets bas (_), sans espaces.",
    ),
  phone: z
    .string()
    .trim()
    .transform((v) => v.replace(/[\s().-]/g, ""))
    .pipe(
      z
        .string()
        .regex(
          /^\+[1-9]\d{7,14}$/,
          "Ajoutez + et l’indicatif du pays, puis 8 à 15 chiffres au total. Exemple : +243812345678.",
        ),
    ),
};
export const registrationPassword = z
  .string()
  .min(12, "Le mot de passe doit contenir au moins 12 caractères.")
  .max(72, "Le mot de passe doit contenir au maximum 72 caractères.")
  .regex(/[a-z]/, "Ajoutez une lettre minuscule (a–z).")
  .regex(/[A-Z]/, "Ajoutez une lettre majuscule (A–Z).")
  .regex(/[0-9]/, "Ajoutez un chiffre (0–9).")
  .regex(/[^a-zA-Z0-9]/, "Ajoutez un symbole, par exemple !, @ ou #.");
export const registrationSchema = z
  .object({
    ...profileFields,
    email: z
      .string()
      .trim()
      .pipe(
        z.email(
          "Saisissez une adresse e-mail valide, par exemple nom@gmail.com.",
        ),
      )
      .transform((v) => v.toLowerCase()),
    password: registrationPassword,
    confirmPassword: z.string().min(1, "Confirmez votre mot de passe."),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "La confirmation ne correspond pas au mot de passe.",
  });
