import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, useData, useSession, Form, Field, Status, type User } from "./lib";
export function GoogleButton({ link = false }: { link?: boolean }) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="google-option">
      <button
        type="button"
        className="google-button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const r = await api("/auth/google/start", "POST", { link });
            window.location.assign(r.url);
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}
      >
        <span aria-hidden="true" className="google-letter">
          G
        </span>
        {busy
          ? "Connexion à Google…"
          : link
            ? "Associer mon compte Google"
            : "Continuer avec Google"}
      </button>
      <Status error={error} />
    </div>
  );
}
export function GoogleComplete() {
  const d = useData("/auth/google/pending");
  const navigate = useNavigate();
  const { refresh } = useSession();
  return (
    <div className="auth">
      <Link to="/connexion">← PLANÈTE LIBIA AI</Link>
      <div className="panel">
        <h1>
          {d.data?.mode === "mfa"
            ? "Confirmez votre connexion"
            : "Bienvenue sur Planète Libia"}
        </h1>
        <Status {...d} />
        {d.data && (
          <>
            <p>
              {d.data.mode === "mfa"
                ? "Saisissez le code de votre application d’authentification."
                : `Google a confirmé ${d.data.email}. Choisissez votre nom d’utilisateur et ajoutez votre téléphone pour terminer.`}
            </p>
            <Form
              label="Continuer"
              onSubmit={async (b) => {
                const logged = await api<User>("/auth/google/complete", "POST", b);
                await refresh();
                navigate(logged.role === "ADMIN" ? "/admin" : "/accueil");
              }}
            >
              {d.data.mode === "mfa" ? (
                <Field name="otp" label="Code 2FA" />
              ) : (
                <>
                  <Field
                    name="name"
                    label="Nom et prénom"
                    value={d.data.name}
                  />
                  <Field
                    name="username"
                    label="Nom d’utilisateur"
                    hint="3 à 30 lettres sans accent, chiffres ou _ ; sans espaces."
                  />
                  <Field
                    name="phone"
                    label="Téléphone avec indicatif"
                    type="tel"
                    hint="Exemple : +243812345678. Les espaces sont acceptés."
                  />
                </>
              )}
            </Form>
          </>
        )}
      </div>
    </div>
  );
}
export function GoogleError() {
  const key = new URLSearchParams(window.location.search).get("google_error");
  const messages: Record<string, string> = {
    cancelled: "Connexion Google annulée. Vous pouvez réessayer.",
    failed: "La connexion Google a échoué ou expiré. Réessayez.",
    unavailable: "Ce compte n’est pas disponible.",
    email_exists:
      "Cette adresse possède déjà un compte. Connectez-vous avec votre mot de passe, puis associez Google dans Paramètres.",
  };
  return key ? <Status error={messages[key] || messages.failed} /> : null;
}
