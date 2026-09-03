import { PublicNav } from "./public-nav";
import { GoogleButton } from "./google";
import { PushSettings } from "./push";
import { useState, useEffect } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import {
  api,
  useData,
  useSession,
  Status,
  Form,
  Field,
  Avatar,
  Pager,
  upload,
} from "./lib";
export function News() {
  const [q, setQ] = useState(""),
    [category, setCategory] = useState(""),
    [page, setPage] = useState(1);
  const categories = useData("/categories");
  const d = useData(
    `/news?q=${encodeURIComponent(q)}&category=${category}&page=${page}`,
  );
  return (
    <div className="public-page">
      <PublicNav />
      <Link to="/accueil">← PLANÈTE LIBIA AI</Link>
      <span className="eyebrow">S’INFORMER, COMPRENDRE, AVANCER</span>
      <h1>Actualités</h1>
      <p className="subtitle">
        Un regard ouvert sur le monde et notre communauté.
      </p>
      <label>
        Rechercher un article
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          placeholder="Que souhaitez-vous découvrir ?"
        />
      </label>
      <div className="tabs">
        <button
          className={!category ? "active" : ""}
          onClick={() => setCategory("")}
        >
          Toutes
        </button>
        {categories.data?.map((c: any) => (
          <button
            key={c.id}
            className={category === c.id ? "active" : ""}
            onClick={() => {
              setCategory(c.id);
              setPage(1);
            }}
          >
            {c.name}
          </button>
        ))}
      </div>
      <Status {...d} />
      <div className="news-grid">
        {d.data?.map((a: any) => (
          <Link className="news-card" key={a.id} to={`/actualites/${a.id}`}>
            {a.imageId && (
              <img src={`/api/media/${a.imageId}`} alt="" loading="lazy" />
            )}
            <span className="eyebrow">{a.category.name}</span>
            <h2>{a.title}</h2>
            <p>{a.summary}</p>
            <small>{new Date(a.publishedAt).toLocaleDateString("fr")}</small>
          </Link>
        ))}
      </div>
      {!d.loading && !d.data?.length && (
        <div className="empty">Aucun article publié pour cette recherche.</div>
      )}
      <Pager page={page} setPage={setPage} count={d.data?.length || 0} />
    </div>
  );
}
export function Article() {
  const { id } = useParams();
  const d = useData(`/news/${id}`);
  useEffect(() => {
    if (d.data) {
      document.title = `${d.data.title} — PLANÈTE LIBIA AI`;
      document
        .querySelector('meta[name="description"]')
        ?.setAttribute("content", d.data.summary);
    }
  }, [d.data]);
  return (
    <article className="public-page article">
      <PublicNav />
      <Link to="/actualites">← Actualités</Link>
      <Status {...d} />
      {d.data && (
        <>
          <span className="eyebrow">{d.data.category.name}</span>
          <h1>{d.data.title}</h1>
          <p className="subtitle">{d.data.summary}</p>
          <small>
            {d.data.author.name} ·{" "}
            {new Date(d.data.publishedAt).toLocaleDateString("fr")}
          </small>
          {d.data.imageId && (
            <img src={`/api/media/${d.data.imageId}`} alt="" />
          )}
          <div className="article-body">{d.data.content}</div>
        </>
      )}
    </article>
  );
}
export function Profile() {
  const { id } = useParams();
  const { user, refresh } = useSession();
  const mine = !id || id === user?.id;
  const d = useData(id ? `/users/${id}` : "/me");
  const [error, setError] = useState("");
  const navigate = useNavigate();
  return (
    <>
      <h1>{mine ? "Mon profil" : "Profil"}</h1>
      <Status error={d.error || error} loading={d.loading} />
      {d.data && (
        <>
          <div className="profile-heading">
            <Avatar user={d.data} />
            <div>
              <h2>{d.data.name}</h2>
              <p>@{d.data.username}</p>
              <small>Identifiant : {d.data.id}</small>
            </div>
          </div>
          <p>{d.data.bio}</p>
          <div className="actions">
            <span>
              {d.data.stats?.articles ?? d.data._count?.articles ?? 0}{" "}
              publications
            </span>
            {mine && (
              <>
                <span>{d.data.stats?.memberships ?? 0} groupes</span>
                <span>{d.data.stats?.contacts ?? 0} contacts</span>
              </>
            )}
          </div>
          {mine ? (
            <div className="panel">
              <Form
                onSubmit={async (b) => {
                  await api("/me", "PATCH", b);
                  await refresh();
                  d.reload();
                }}
              >
                <Field name="name" label="Nom complet" value={d.data.name} />
                <label>
                  Biographie
                  <textarea
                    name="bio"
                    defaultValue={d.data.bio}
                    maxLength={1000}
                  />
                </label>
              </Form>
              <label>
                Photo de profil
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={async (e) => {
                    try {
                      if (e.target.files?.[0]) {
                        const f = await upload(e.target.files[0]);
                        await api("/me", "PATCH", { avatarId: f.id });
                        await refresh();
                        d.reload();
                      }
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                />
              </label>
              <div className="actions">
                <Link className="button" to="/contacts">
                  Mes contacts
                </Link>
                <Link className="button" to="/discussions">
                  Mes groupes
                </Link>
                <Link className="button" to="/parametres">
                  Paramètres du compte
                </Link>
              </div>
            </div>
          ) : (
            <div className="actions">
              <button
                className="gold"
                onClick={async () => {
                  try {
                    const r = await api("/rooms/private", "POST", {
                      userId: id,
                    });
                    navigate(`/discussions/${r.id}`);
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Discuter
              </button>
              <button
                onClick={async () => {
                  if (confirm("Bloquer cette personne ?")) {
                    await api(`/blocks/${id}`, "POST", {});
                    navigate("/contacts");
                  }
                }}
              >
                Bloquer
              </button>
              <button
                onClick={async () => {
                  const reason = prompt(
                    "Motif du signalement (10 caractères minimum)",
                  );
                  if (reason)
                    try {
                      await api("/reports", "POST", {
                        targetType: "USER",
                        targetId: id,
                        reason,
                      });
                      alert("Signalement envoyé.");
                    } catch (e) {
                      setError((e as Error).message);
                    }
                }}
              >
                Signaler
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}
export function SettingsPage() {
  const { user, refresh } = useSession();
  const sessions = useData("/sessions"),
    blocks = useData("/blocks");
  const [error, setError] = useState(""),
    [totp, setTotp] = useState<any>(null);
  const navigate = useNavigate();
  async function setting(b: any) {
    try {
      await api("/me", "PATCH", b);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <h1>Paramètres</h1>
      <Status error={error} />
      <div className="settings-grid">
        <section className="panel">
          <h2>Confidentialité & apparence</h2>
          <label className="check">
            <input
              type="checkbox"
              checked={user?.discoverable}
              onChange={(e) => void setting({ discoverable: e.target.checked })}
            />
            Autoriser la découverte de mon profil
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={user?.showPresence}
              onChange={(e) => void setting({ showPresence: e.target.checked })}
            />
            Afficher ma présence en ligne
          </label>
          <label>
            Thème
            <select
              value={user?.theme}
              onChange={(e) => void setting({ theme: e.target.value })}
            >
              <option value="dark">Sombre</option>
              <option value="light">Clair</option>
            </select>
          </label>
          <label>
            Langue
            <select
              value={user?.language}
              onChange={(e) => void setting({ language: e.target.value })}
            >
              <option value="fr">Français</option>
              <option value="en">English (navigation)</option>
            </select>
          </label>
          <PushSettings />
          <h3>Notifications</h3>
          {["messages", "groups", "calls", "news", "security", "system"].map(
            (k, i) => (
              <label className="check" key={k}>
                <input
                  type="checkbox"
                  checked={user?.preferences[k] !== false}
                  onChange={(e) =>
                    void setting({
                      preferences: {
                        ...user?.preferences,
                        [k]: e.target.checked,
                      },
                    })
                  }
                />
                {
                  [
                    "Messages",
                    "Groupes",
                    "Appels",
                    "Actualités",
                    "Sécurité",
                    "Système",
                  ][i]
                }
              </label>
            ),
          )}
        </section>
        <section className="panel">
          <h2>Mot de passe</h2>
          <GoogleButton link />
          <Form
            label="Modifier et fermer les sessions"
            onSubmit={async (b) => {
              await api("/security/password", "POST", { current: "", ...b });
              await refresh();
              navigate("/connexion");
            }}
          >
            {user?.passwordLogin !== false && (
              <Field
                name="current"
                label="Mot de passe actuel"
                type="password"
              />
            )}
            {user?.passwordLogin === false && (
              <p>
                Vous utilisez Google. Créez un mot de passe pour disposer d’une
                autre connexion et gérer la suppression du compte.
                Reconnectez-vous avec Google si votre connexion date de plus de
                10 minutes.
              </p>
            )}
            <Field
              name="password"
              label="Nouveau mot de passe fort (12 caractères minimum)"
              type="password"
            />
          </Form>
          <h2>Authentification à deux facteurs</h2>
          <p>{user?.totpEnabled ? "Activée" : "Désactivée"}</p>
          {!user?.totpEnabled ? (
            <>
              <button
                onClick={async () => {
                  try {
                    setTotp(await api("/security/2fa/setup", "POST", {}));
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Configurer une application d’authentification
              </button>
              {totp && (
                <>
                  <p>
                    Ajoutez cette clé dans votre application d’authentification
                    :
                  </p>
                  <code className="secret">{totp.secret}</code>
                  <Form
                    label="Activer"
                    onSubmit={async (b) => {
                      await api("/security/2fa/confirm", "POST", b);
                      setTotp(null);
                      await refresh();
                    }}
                  >
                    <Field name="code" label="Code de l’application" />
                  </Form>
                </>
              )}
            </>
          ) : (
            <Form
              label="Désactiver la 2FA"
              onSubmit={async (b) => {
                await api("/security/2fa/disable", "POST", b);
                await refresh();
              }}
            >
              <Field name="password" label="Mot de passe" type="password" />
              <Field name="code" label="Code 2FA" />
            </Form>
          )}
        </section>
        <section className="panel">
          <h2>Sessions actives</h2>
          <Status {...sessions} />
          {sessions.data?.map((s: any) => (
            <div className="list-row" key={s.id}>
              <span>
                {s.userAgent.slice(0, 80)}
                <small>
                  {s.current ? "Cette session" : "Autre session"} ·{" "}
                  {new Date(s.createdAt).toLocaleDateString("fr")}
                </small>
              </span>
              <button
                onClick={async () => {
                  await api(`/sessions/${s.id}`, "DELETE");
                  sessions.reload();
                  await refresh();
                }}
              >
                Révoquer
              </button>
            </div>
          ))}
        </section>
        <section className="panel">
          <h2>Personnes bloquées</h2>
          {blocks.data?.map((b: any) => (
            <div className="list-row" key={b.targetId}>
              <span>{b.target.name}</span>
              <button
                onClick={async () => {
                  await api(`/blocks/${b.targetId}`, "DELETE");
                  blocks.reload();
                }}
              >
                Débloquer
              </button>
            </div>
          ))}
          {!blocks.data?.length && <p>Aucune personne bloquée.</p>}
          <h2>Aide et assistance</h2>
          <Form
            label="Envoyer au support"
            onSubmit={(b) =>
              api("/reports", "POST", {
                targetType: "SUPPORT",
                targetId: user?.id,
                reason: b.reason,
              })
            }
          >
            <label>
              Votre demande
              <textarea name="reason" minLength={10} required />
            </label>
          </Form>
          <Link to="/a-propos">À propos de l’application · Version 1.0.0</Link>
        </section>
        <section className="panel">
          <h2>Supprimer mon compte</h2>
          <p>
            Votre profil sera anonymisé et vos sessions et conversations IA
            supprimées. Les messages partagés restent dans les discussions.
          </p>
          <Form
            label="Supprimer définitivement mon compte"
            onSubmit={async (b) => {
              if (!confirm("Confirmer la suppression de votre compte ?"))
                return;
              await api("/me", "DELETE", b);
              await refresh();
              navigate("/");
            }}
          >
            <Field
              name="password"
              label="Confirmez votre mot de passe"
              type="password"
            />
          </Form>
        </section>
      </div>
    </>
  );
}
export function Notifications() {
  const [page, setPage] = useState(1);
  const d = useData(`/notifications?page=${page}`);
  return (
    <>
      <h1>Notifications</h1>
      <Status {...d} />
      {d.data?.items.map((n: any) => (
        <div className={`list-row ${!n.readAt ? "unread" : ""}`} key={n.id}>
          <Link to={n.path}>
            {n.title}
            <small>{new Date(n.createdAt).toLocaleString("fr")}</small>
          </Link>
          {!n.readAt && (
            <button
              onClick={async () => {
                await api(`/notifications/${n.id}/read`, "POST", {});
                d.reload();
              }}
            >
              Marquer comme lue
            </button>
          )}
        </div>
      ))}
      {!d.data?.items.length && <div className="empty">Vous êtes à jour.</div>}
      <Pager page={page} setPage={setPage} count={d.data?.items.length || 0} />
    </>
  );
}
export function About() {
  const d = useData("/public/settings"),
    content = useData("/content");
  return (
    <div className="public-page about">
      <Link to="/accueil">← PLANÈTE LIBIA AI</Link>
      <span className="eyebrow">À PROPOS DU RESPONSABLE</span>
      <h1>
        Grâce à José LIBIA
        <br />
        <em>(JO LIBIA)</em>
      </h1>
      <p className="subtitle">Fils de José LIBIA et Martine Yetene.</p>
      <h2>Fondateur et responsable de PLANÈTE LIBIA AI</h2>
      <p>
        Mettre la technologie et l’intelligence artificielle au service de la
        population, à travers l’information, la communication et le
        développement.
      </p>
      <h2>L’intelligence au service du peuple</h2>
      <p>
        PLANÈTE LIBIA AI réunit l’assistance intelligente, les échanges et
        l’information dans un espace commun.
      </p>
      {d.data?.contact ? (
        <a className="button gold" href={`mailto:${d.data.contact}`}>
          Contacter le responsable
        </a>
      ) : (
        <p>Le contact officiel sera disponible dès sa configuration.</p>
      )}
      {d.data?.social && (
        <a
          className="button"
          href={d.data.social}
          target="_blank"
          rel="noreferrer"
        >
          Réseau officiel
        </a>
      )}
      <h2>Informations légales</h2>
      <p>
        {content.data?.find((s: any) => s.key === "legalText")?.value ||
          "Les informations légales de l’exploitant doivent être renseignées avant l’ouverture publique."}
      </p>
      <small>PLANÈTE LIBIA AI · Version 1.0.0</small>
    </div>
  );
}
export function Admin() {
  const { user } = useSession();
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("stats"),
    [page, setPage] = useState(1),
    [error, setError] = useState(""),
    [editing, setEditing] = useState<any>(null);
  const d = useData(
    `/admin/${tab}?page=${page}&q=${encodeURIComponent(query)}`,
  );
  const cats = useData("/categories");
  const aiConfig = useData<any>("/admin/ai-config");
  if (user?.role !== "ADMIN")
    return <p role="alert">Accès administrateur requis.</p>;
  async function action(path: string, method: string, body?: any) {
    try {
      await api(path, method, body);
      d.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="admin">
      <span className="eyebrow">ESPACE PROTÉGÉ</span>
      <h1>Administration</h1>
      <div className="tabs">
        {[
          ["stats", "Vue d’ensemble"],
          ["users", "Utilisateurs"],
          ["groups", "Groupes"],
          ["news", "Publications"],
          ["reports", "Signalements"],
          ["settings", "Configuration"],
          ["system", "Services externes"],
          ["audit", "Journal d’audit"],
        ].map(([k, v]) => (
          <button
            className={tab === k ? "active" : ""}
            key={k}
            onClick={() => {
              setTab(k);
              setPage(1);
              setError("");
            }}
          >
            {v}
          </button>
        ))}
      </div>
      <Status error={error || d.error} loading={d.loading} />
      {tab === "users" && (
        <label>
          Rechercher un utilisateur
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
          />
        </label>
      )}
      {tab === "stats" && (
        <div className="service-grid">
          {Object.entries(d.data || {}).map(([k, v]) => (
            <div className="panel" key={k}>
              <strong className="stat">{String(v)}</strong>
              <p>{k}</p>
            </div>
          ))}
        </div>
      )}
      {tab === "system" && (
        <div className="service-grid">
          {Object.entries(d.data || {}).map(([key, value]: [string, any]) => (
            <div className="panel" key={key}>
              <span className="eyebrow">{key}</span>
              <h3>{typeof value === "object" ? value.status : value}</h3>
              {typeof value === "object" && <p>{[value.provider, value.model].filter(Boolean).join(" · ") || "Aucun secret affiché"}</p>}
            </div>
          ))}
          <p className="notice">Les clés API restent dans les variables d’environnement du serveur et ne sont jamais affichées ici.</p>
        </div>
      )}
      {tab === "users" &&
        d.data?.map((u: any) => (
          <div className="list-row" key={u.id}>
            <Avatar user={u} />
            <Link to={`/profil/${u.id}`}>
              {u.name}
              <small>
                {u.email} · {u.status}
              </small>
            </Link>
            {u.role !== "ADMIN" && u.status !== "DELETED" && (
              <>
                <button
                  onClick={() =>
                    void action(`/admin/users/${u.id}`, "PATCH", {
                      status: u.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE",
                    })
                  }
                >
                  {u.status === "ACTIVE" ? "Suspendre" : "Restaurer"}
                </button>
                <button
                  onClick={() => {
                    if (
                      confirm(
                        `Supprimer et anonymiser le compte de ${u.name} ?`,
                      )
                    )
                      void action(`/admin/users/${u.id}`, "DELETE");
                  }}
                >
                  Supprimer
                </button>
              </>
            )}
          </div>
        ))}
      {tab === "groups" &&
        d.data?.map((g: any) => (
          <div className="list-row" key={g.id}>
            <span>
              {g.name}
              <small>
                {g._count.members} membres · {g._count.messages} messages
              </small>
            </span>
            <button
              onClick={() =>
                void action(`/admin/groups/${g.id}`, "PATCH", {
                  locked: !g.locked,
                })
              }
            >
              {g.locked ? "Déverrouiller" : "Verrouiller"}
            </button>
          </div>
        ))}
      {tab === "news" && (
        <>
          <button className="gold" onClick={() => setEditing({})}>
            Nouvel article
          </button>
          {editing && (
            <div className="panel" key={editing.id || "new"}>
              <Form
                label="Enregistrer l’article"
                onSubmit={async (b) => {
                  await api(
                    editing.id ? `/admin/news/${editing.id}` : "/admin/news",
                    editing.id ? "PATCH" : "POST",
                    {
                      ...b,
                      published: b.published === "on",
                      imageId: b.imageId || null,
                    },
                  );
                  setEditing(null);
                  d.reload();
                }}
              >
                <Field name="title" label="Titre" value={editing.title} />
                <Field name="summary" label="Résumé" value={editing.summary} />
                <label>
                  Contenu
                  <textarea
                    name="content"
                    defaultValue={editing.content}
                    required
                    rows={10}
                  />
                </label>
                <label>
                  Catégorie
                  <select name="categoryId" defaultValue={editing.categoryId}>
                    {cats.data?.map((c: any) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <Field
                  name="imageId"
                  label="Identifiant de l’image"
                  value={editing.imageId || ""}
                  required={false}
                />
                <label>
                  Importer une image
                  <input
                    type="file"
                    accept="image/*"
                    onChange={async (e) => {
                      if (e.target.files?.[0])
                        try {
                          const f = await upload(e.target.files[0]);
                          const input = e.target.form?.elements.namedItem(
                            "imageId",
                          ) as HTMLInputElement;
                          if (input) input.value = f.id;
                        } catch (e) {
                          setError((e as Error).message);
                        }
                    }}
                  />
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    name="published"
                    defaultChecked={!!editing.publishedAt}
                  />
                  Publier
                </label>
              </Form>
              <button onClick={() => setEditing(null)}>Annuler</button>
            </div>
          )}
          {d.data?.map((a: any) => (
            <div className="list-row" key={a.id}>
              <span>
                {a.title}
                <small>
                  {a.publishedAt ? "Publié" : "Brouillon"} · {a.category.name}
                </small>
              </span>
              <button onClick={() => setEditing(a)}>Modifier</button>
              <button
                onClick={() => {
                  if (confirm("Supprimer cet article ?"))
                    void action(`/admin/news/${a.id}`, "DELETE");
                }}
              >
                Supprimer
              </button>
            </div>
          ))}
          <h2>Catégories</h2>
          <Form
            label="Ajouter une catégorie"
            onSubmit={async (b) => {
              await api("/admin/categories", "POST", b);
              cats.reload();
            }}
          >
            <Field name="name" label="Nom de la catégorie" />
          </Form>
          {cats.data?.map((c: any) => (
            <div className="list-row" key={c.id}>
              <span>{c.name}</span>
              <button
                onClick={async () => {
                  await action(`/admin/categories/${c.id}`, "DELETE");
                  cats.reload();
                }}
              >
                Supprimer
              </button>
            </div>
          ))}
        </>
      )}
      {tab === "reports" &&
        d.data?.map((r: any) => (
          <div className="panel" key={r.id}>
            <h3>
              {r.targetType} · {r.state}
            </h3>
            <code>{r.targetId}</code>
            <p>{r.reason}</p>
            <p>{r.resolution}</p>
            <button
              onClick={() => {
                const resolution = prompt("Résolution du signalement");
                if (resolution)
                  void action(`/admin/reports/${r.id}`, "PATCH", {
                    state: "RESOLVED",
                    resolution,
                  });
              }}
            >
              Résoudre
            </button>
            {r.targetType === "MESSAGE" && (
              <button
                onClick={() =>
                  void action(`/admin/messages/${r.targetId}`, "DELETE")
                }
              >
                Retirer le message
              </button>
            )}
          </div>
        ))}
      {tab === "settings" && (
        <>
          <div className="panel">
            <span className="eyebrow">OPENAI</span>
            <h2>Clé API OpenAI</h2>
            <p className="muted">
              {aiConfig.data?.configured
                ? `Configurée · ${aiConfig.data.model} · source ${aiConfig.data.source === "environment" ? "serveur" : "administration"}`
                : "Service IA non configuré"}
            </p>
            <Form
              label={aiConfig.data?.configured ? "Remplacer la clé" : "Ajouter la clé API"}
              onSubmit={async (b) => {
                await api("/admin/ai-config", "PUT", { apiKey: b.apiKey });
                aiConfig.reload();
              }}
            >
              <Field name="apiKey" label="Clé secrète OpenAI" type="password" />
            </Form>
            {aiConfig.data?.configured && aiConfig.data.source !== "environment" && (
              <button className="danger" onClick={async () => {
                if (confirm("Retirer la clé OpenAI enregistrée ?")) {
                  await api("/admin/ai-config", "DELETE");
                  aiConfig.reload();
                }
              }}>Retirer la clé enregistrée</button>
            )}
            <small>La clé est chiffrée côté serveur et ne peut jamais être relue depuis ce tableau de bord.</small>
          </div>
          <Form
            onSubmit={async (b) => {
              await api("/admin/settings", "PUT", b);
              d.reload();
            }}
          >
            <label>
              Paramètre
              <select name="key">
                <option value="announcement">Annonce</option>
                <option value="supportText">Assistance</option>
                <option value="legalText">Informations légales</option>
              </select>
            </label>
            <label>
              Texte
              <textarea name="value" required />
            </label>
          </Form>
          {d.data?.map((s: any) => (
            <div className="panel" key={s.key}>
              <h3>{s.key}</h3>
              <p>{s.value}</p>
            </div>
          ))}
        </>
      )}
      {tab === "audit" &&
        d.data?.map((a: any) => (
          <div className="list-row" key={a.id}>
            <span>
              {a.action}
              <small>
                {a.actor.name} · {a.target}
              </small>
            </span>
            <time>{new Date(a.createdAt).toLocaleString("fr")}</time>
          </div>
        ))}
      {tab !== "stats" && tab !== "settings" && (
        <Pager page={page} setPage={setPage} count={d.data?.length || 0} />
      )}
    </div>
  );
}
