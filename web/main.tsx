import { registerSearch } from "./webmcp";
import { GlobalSearch } from "./search";
import { GoogleButton, GoogleComplete, GoogleError } from "./google";
import React from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  NavLink,
  Link,
  Outlet,
  useNavigate,
} from "react-router-dom";
import { useState, useEffect } from "react";
import {
  Home as HomeIcon,
  MessageCircle,
  Sparkles,
  Newspaper,
  UserRound,
  Settings,
  Bell,
  LogOut,
  Phone,
  Shield,
  ArrowUpRight,
  Search,
  Menu,
  X,
  Eye,
  EyeOff,
  Users,
  BarChart3,
  FileText,
  Flag,
  Activity,
} from "lucide-react";
import {
  SessionProvider,
  useSession,
  api,
  Form,
  Field,
  useData,
  Status,
  Avatar,
  dictionary,
  socket,
  type User,
} from "./lib";
import { Discussions, Chat, AI, People, Group } from "./social";
import {
  News,
  Article,
  Profile,
  SettingsPage,
  Notifications,
  About,
  Admin,
} from "./pages";
import { CallProvider, CallHistory } from "./calls";
import "./style.css";
function Brand() {
  return (
    <Link className="brand" to="/">
      <span className="monogram">
        PL<span>IA</span>
      </span>
      <span>
        PLANÈTE LIBIA <b>AI</b>
        <small>L’intelligence au service du peuple</small>
      </span>
    </Link>
  );
}
function Landing() {
  return (
    <div className="landing">
      <header>
        <Brand />
        <Link to="/connexion">
          Se connecter <ArrowUpRight size={16} />
        </Link>
      </header>
      <main className="hero">
        <span className="eyebrow">
          INTELLIGENCE · COMMUNICATION · COMMUNAUTÉ
        </span>
        <h1>
          Le savoir nous rapproche.
          <br />
          <em>L’intelligence nous élève.</em>
        </h1>
        <p>
          Un espace pour apprendre, échanger et avancer ensemble. Bienvenue sur
          PLANÈTE LIBIA AI.
        </p>
        <div className="actions">
          <Link className="button gold" to="/inscription">
            Créer un compte <ArrowUpRight size={18} />
          </Link>
          <Link className="button" to="/connexion">
            Se connecter
          </Link>
        </div>
        <div className="hero-services">
          {[
            [Sparkles, "Une IA à vos côtés", "Écrivez, apprenez, explorez."],
            [
              MessageCircle,
              "Vos liens, en direct",
              "Discutez et partagez avec vos proches.",
            ],
            [
              Newspaper,
              "Un regard sur le monde",
              "L’information au service de tous.",
            ],
          ].map(([Icon, title, desc]: any) => (
            <div key={title}>
              <Icon />
              <h3>{title}</h3>
              <p>{desc}</p>
            </div>
          ))}
        </div>
      </main>
      <footer>
        <Brand />
        <Link to="/a-propos">À propos du responsable</Link>
        <Link to="/actualites">Actualités</Link>
      </footer>
    </div>
  );
}
function AuthPage({ mode }: { mode: "login" | "register" | "verify" }) {
  const navigate = useNavigate();
  const { refresh } = useSession();
  const [login, setLogin] = useState(
    sessionStorage.getItem("verificationLogin") || "",
  );
  const [delivery, setDelivery] = useState("");
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (seconds <= 0) return;
    const t = setTimeout(() => setSeconds(seconds - 1), 1000);
    return () => clearTimeout(t);
  }, [seconds]);
  return (
    <div className="auth">
      <Brand />
      <div className="panel">
        <span className="eyebrow">VOTRE ESPACE PLANÈTE LIBIA</span>
        <h1>
          {mode === "register"
            ? "Rejoignez la communauté."
            : mode === "verify"
              ? "Vérification du compte"
              : "Heureux de vous retrouver."}
        </h1>
        <GoogleError />
        {mode !== "verify" && (
          <>
            <GoogleButton />
            <div className="auth-divider">ou avec vos informations</div>
          </>
        )}
        {mode === "register" ? (
          <Form
            label="Créer mon compte"
            onSubmit={async (b) => {
              const result = await api("/auth/register", "POST", b);
              sessionStorage.setItem("verificationLogin", b.email);
              sessionStorage.setItem("deliveryMessage", result.message);
              navigate("/verification");
            }}
          >
            <Field name="name" label="Nom et prénom" />
            <Field
              name="username"
              label="Nom d’utilisateur"
              hint="3 à 30 lettres sans accent, chiffres ou _ ; pas d’espaces. Exemple : jo_libia"
            />
            <Field
              name="phone"
              label="Téléphone avec indicatif (+243…)"
              type="tel"
              hint="Exemple : +243812345678. Les espaces, parenthèses et tirets sont acceptés."
            />
            <Field name="email" label="Adresse e-mail" type="email" />
            <Field
              name="password"
              label="Mot de passe (12 caractères, majuscule, minuscule, chiffre, symbole)"
              type="password"
              hint="Au moins 12 caractères, avec a–z, A–Z, 0–9 et un symbole comme ! ou @."
            />
            <Field
              name="confirmPassword"
              label="Confirmation du mot de passe"
              type="password"
            />
          </Form>
        ) : mode === "login" ? (
          <Form
            label="Se connecter"
            onSubmit={async (b) => {
              const logged = await api<User>("/auth/login", "POST", b);
              await refresh();
              navigate(logged.role === "ADMIN" ? "/admin" : "/accueil");
            }}
          >
            <Field
              name="login"
              label="E-mail, téléphone ou nom d’utilisateur"
            />
            <Field name="password" label="Mot de passe" type="password" />
            <Field name="otp" label="Code 2FA (si activé)" required={false} />
          </Form>
        ) : (
          <>
            <p className="notice">
              {sessionStorage.getItem("deliveryMessage") ||
                "Saisissez le code reçu. Il expire après 10 minutes."}
            </p>
            <Form
              label="Vérifier"
              onSubmit={async (b) => {
                await api("/auth/verify", "POST", { ...b, login });
                navigate("/connexion");
              }}
            >
              <label>
                E-mail, téléphone ou identifiant
                <input
                  value={login}
                  onChange={(e) => setLogin(e.target.value)}
                  required
                />
              </label>
              <Field name="code" label="Code à six chiffres" />
            </Form>
            <button
              disabled={seconds > 0}
              onClick={async () => {
                try {
                  await api("/auth/resend", "POST", { login });
                  setSeconds(60);
                  setDelivery("Demande prise en compte.");
                } catch (e) {
                  setDelivery((e as Error).message);
                }
              }}
            >
              {seconds ? `Renvoyer dans ${seconds}s` : "Renvoyer le code"}
            </button>
            <p role="status">{delivery}</p>
          </>
        )}
        <div className="auth-links">
          <Link to="/connexion">Connexion</Link>
          <Link to="/inscription">Inscription</Link>
          <Link to="/verification">Vérifier mon compte</Link>
        </div>
      </div>
    </div>
  );
}
function Protected() {
  const { user, loading, refresh } = useSession();
  const navigate = useNavigate();
  const [count, setCount] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (!user) return;
    api("/notifications")
      .then((n) => setCount(n.unread))
      .catch(() => {});
    const update = () => setCount((c) => c + 1);
    const recount = () => {
      void api("/notifications")
        .then((n) => setCount(n.unread))
        .catch(() => {});
    };
    socket.on("notification", update);
    window.addEventListener("notifications-changed", recount);
    return () => {
      socket.off("notification", update);
      window.removeEventListener("notifications-changed", recount);
    };
  }, [user]);
  if (loading) return <Status loading />;
  if (!user) return <Navigate to="/connexion" />;
  if (user.role === "ADMIN") return <Navigate to="/admin" replace />;
  const text = dictionary[user.language === "en" ? "en" : "fr"];
  const nav = [
    ["/accueil", HomeIcon, text.home],
    ["/discussions", MessageCircle, text.chats],
    ["/ia", Sparkles, text.ai],
    ["/actualites", Newspaper, text.news],
    ["/profil", UserRound, text.profile],
  ] as const;
  return (
    <CallProvider>
      <div className="app-shell">
        {menuOpen && (
          <button
            className="sidebar-backdrop"
            aria-label="Fermer le menu"
            onClick={() => setMenuOpen(false)}
          />
        )}
        <aside className={menuOpen ? "open" : ""}>
          <button
            className="sidebar-close"
            aria-label="Fermer le menu"
            onClick={() => setMenuOpen(false)}
          >
            <X size={22} />
          </button>
          <Brand />
          <nav>
            {nav.map(([to, Icon, label]) => (
              <NavLink key={to} to={to} onClick={() => setMenuOpen(false)}>
                <Icon size={21} />
                <span>{label}</span>
              </NavLink>
            ))}
          </nav>
          <div className="side-extra">
            <NavLink to="/contacts" onClick={() => setMenuOpen(false)}>
              <Search size={18} />
              Contacts
            </NavLink>
            <NavLink to="/appels" onClick={() => setMenuOpen(false)}>
              <Phone size={18} />
              Appels
            </NavLink>
            <NavLink to="/parametres" onClick={() => setMenuOpen(false)}>
              <Settings size={18} />
              Paramètres
            </NavLink>
            {user.role === "ADMIN" && (
              <NavLink to="/admin" onClick={() => setMenuOpen(false)}>
                <Shield size={18} />
                Administration
              </NavLink>
            )}
            <NavLink to="/a-propos" onClick={() => setMenuOpen(false)}>
              À propos
            </NavLink>
          </div>
          <div className="side-user">
            <Avatar user={user} />
            <span>
              {user.name}
              <small>@{user.username}</small>
            </span>
            <button
              aria-label="Se déconnecter"
              onClick={async () => {
                await api("/auth/logout", "POST", {});
                await refresh();
                navigate("/");
              }}
            >
              <LogOut size={16} />
            </button>
          </div>
        </aside>
        <div className="workspace">
          <header className="topbar">
            <div className="topbar-start">
              <button
                className="menu-toggle"
                aria-label="Ouvrir le menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen(true)}
              >
                <Menu size={22} />
              </button>
              <span>Votre espace, vos possibilités.</span>
            </div>
            <Link
              className="button"
              to="/notifications"
              aria-label={`Notifications : ${count} nouvelles`}
            >
              <Bell size={19} />
              {count > 0 && <b>{count}</b>}
            </Link>
          </header>
          <main className="page">
            <Outlet />
          </main>
        </div>
        <nav className="bottom-nav">
          {nav.map(([to, Icon, label]) => (
            <NavLink key={to} to={to}>
              <Icon size={20} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
      </div>
    </CallProvider>
  );
}

function AdminLogin() {
  const { user, loading, refresh } = useSession();
  const navigate = useNavigate();
  const [visible, setVisible] = useState(false);
  if (loading) return <Status loading />;
  if (user?.role === "ADMIN") return <Navigate to="/admin" replace />;
  return (
    <div className="auth admin-login">
      <Brand />
      <div className="panel">
        <span className="eyebrow">ACCÈS ADMINISTRATION</span>
        <h1>Pilotez la plateforme.</h1>
        <p className="muted">Espace réservé aux administrateurs autorisés.</p>
        <Form label="Accéder au tableau de bord" onSubmit={async (b) => {
          const logged = await api<User>("/auth/login", "POST", b);
          if (logged.role !== "ADMIN") {
            await api("/auth/logout", "POST", {});
            await refresh();
            throw new Error("Ce compte ne dispose pas d’un accès administrateur.");
          }
          await refresh();
          navigate("/admin", { replace: true });
        }}>
          <Field name="login" label="E-mail ou nom d’utilisateur" />
          <label>Mot de passe
            <span className="password-control">
              <input name="password" type={visible ? "text" : "password"} required />
              <button type="button" aria-label={visible ? "Masquer le mot de passe" : "Afficher le mot de passe"} onClick={() => setVisible((value) => !value)}>
                {visible ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </span>
          </label>
          <Field name="otp" label="Code 2FA (si activé)" required={false} />
        </Form>
        <Link className="subtle" to="/connexion">Retour à l’espace utilisateur</Link>
      </div>
    </div>
  );
}

function AdminProtected() {
  const { user, loading, refresh } = useSession();
  const navigate = useNavigate();
  const [drawer, setDrawer] = useState(false);
  if (loading) return <Status loading />;
  if (!user) return <Navigate to="/admin/login" replace />;
  if (user.role !== "ADMIN") return <div className="public-page"><h1>Accès refusé</h1><p>Ce compte ne dispose pas des autorisations administrateur.</p><Link className="button" to="/accueil">Retour à l’application</Link></div>;
  const sections = [
    [BarChart3, "Tableau de bord"], [Users, "Utilisateurs"],
    [MessageCircle, "Communication"], [Sparkles, "Intelligence artificielle"],
    [FileText, "Actualités"], [Flag, "Modération"],
    [Bell, "Notifications"], [Activity, "Système et audit"],
  ] as const;
  return (
    <div className="admin-shell">
      {drawer && <button className="admin-backdrop" aria-label="Fermer le menu" onClick={() => setDrawer(false)} />}
      <aside className={drawer ? "open" : ""}>
        <button className="admin-close" aria-label="Fermer le menu" onClick={() => setDrawer(false)}><X /></button>
        <Brand /><span className="admin-label">CENTRE DE CONTRÔLE</span>
        <nav>{sections.map(([Icon, label]) => <a href="#administration" key={label} onClick={() => setDrawer(false)}><Icon size={18} /><span>{label}</span></a>)}</nav>
        <div className="admin-account"><Avatar user={user} /><span>{user.name}<small>@{user.username}</small></span>
          <button aria-label="Déconnexion" onClick={async () => { await api("/auth/logout", "POST", {}); await refresh(); navigate("/admin/login", { replace: true }); }}><LogOut size={17} /></button>
        </div>
      </aside>
      <section className="admin-workspace">
        <header className="admin-topbar"><button className="admin-menu" aria-label="Ouvrir le menu d’administration" onClick={() => setDrawer(true)}><Menu /></button><div><strong>PLANÈTE LIBIA AI</strong><small>Administration sécurisée</small></div><Link className="button" to="/">Voir la plateforme</Link></header>
        <main id="administration" className="admin-content"><Outlet /></main>
      </section>
    </div>
  );
}
function Home() {
  const { user } = useSession();
  const d = useData("/rooms");
  return (
    <>
      <span className="eyebrow">ENSEMBLE, PLUS LOIN</span>
      <h1>
        Bienvenue, {user?.name.split(" ")[0]}
        <span className="gold-text">.</span>
      </h1>
      <p className="subtitle">
        Une idée, une conversation, une nouvelle perspective.
      </p>
      <Link className="search-link" to="/recherche">
        <Search size={20} />
        Rechercher une personne ou une actualité
        <ArrowUpRight size={18} />
      </Link>
      <Link className="ai-feature" to="/ia">
        <div>
          <span className="eyebrow">PLANÈTE LIBIA AI</span>
          <h2>
            Qu’allez-vous
            <br />
            imaginer aujourd’hui ?
          </h2>
          <p>Une question. Un texte. Une idée à faire grandir.</p>
          <span className="button gold">
            Parler avec l’IA <ArrowUpRight size={18} />
          </span>
        </div>
        <Sparkles className="feature-icon" strokeWidth={0.8} />
      </Link>
      <div className="section-heading">
        <h2>À portée de main</h2>
        <span className="muted">Votre quotidien, simplifié</span>
      </div>
      <div className="service-grid">
        {[
          [
            MessageCircle,
            "Discussions",
            "Retrouvez vos conversations",
            "/discussions",
          ],
          [
            Newspaper,
            "Actualités",
            "Comprendre ce qui nous entoure",
            "/actualites",
          ],
          [Phone, "Appels", "Gardez le contact, de vive voix", "/appels"],
        ].map(([Icon, title, desc, path]: any) => (
          <Link className="service-card" key={path} to={path}>
            <Icon />
            <h3>{title}</h3>
            <p>{desc}</p>
            <ArrowUpRight size={18} />
          </Link>
        ))}
      </div>
      <div className="section-heading">
        <h2>Vos conversations</h2>
        <Link to="/discussions">Tout voir →</Link>
      </div>
      <Status error={d.error} loading={d.loading} />
      {d.data?.length ? (
        d.data.slice(0, 3).map((room: any) => (
          <Link
            className="list-row"
            to={`/discussions/${room.id}`}
            key={room.id}
          >
            <MessageCircle />
            <span>
              {room.name ||
                room.members.find((m: any) => m.userId !== user?.id)?.user.name}
              <small>
                {room.messages[0]?.body || "Commencez la conversation"}
              </small>
            </span>
            <b>{room.unread || ""}</b>
          </Link>
        ))
      ) : (
        <div className="empty">
          Chaque échange commence par un bonjour.{" "}
          <Link to="/contacts">Trouver un contact →</Link>
        </div>
      )}
      <div className="actions">
        <Link className="button" to="/groupes/nouveau">
          Créer un groupe
        </Link>
        <button
          onClick={() => {
            void navigator.clipboard
              .writeText(window.location.origin)
              .then(() => alert("Lien d’invitation copié."))
              .catch(() => alert(window.location.origin));
          }}
        >
          Inviter des amis
        </button>
        <Link className="button" to="/parametres">
          Paramètres
        </Link>
      </div>
    </>
  );
}
function App() {
  return (
    <SessionProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/connexion" element={<AuthPage mode="login" />} />
          <Route path="/inscription" element={<AuthPage mode="register" />} />
          <Route path="/verification" element={<AuthPage mode="verify" />} />
          <Route path="/admin/login" element={<AdminLogin />} />
          <Route path="/google/terminer" element={<GoogleComplete />} />
          <Route path="/a-propos" element={<About />} />
          <Route element={<Protected />}>
            <Route path="/accueil" element={<Home />} />
            <Route path="/discussions" element={<Discussions />} />
            <Route path="/discussions/:id" element={<Chat />} />
            <Route path="/groupes/nouveau" element={<Group />} />
            <Route path="/groupes/:id" element={<Group />} />
            <Route path="/ia" element={<AI />} />
            <Route path="/ia/:id" element={<AI />} />
            <Route path="/contacts" element={<People />} />
            <Route path="/recherche" element={<GlobalSearch />} />
            <Route path="/profil" element={<Profile />} />
            <Route path="/profil/:id" element={<Profile />} />
            <Route path="/parametres" element={<SettingsPage />} />
            <Route path="/notifications" element={<Notifications />} />
            <Route path="/appels" element={<CallHistory />} />
          </Route>
          <Route element={<AdminProtected />}>
            <Route path="/admin/*" element={<Admin />} />
          </Route>
          <Route path="/actualites" element={<News />} />
          <Route path="/actualites/:id" element={<Article />} />
          <Route
            path="*"
            element={
              <div className="public-page">
                <h1>Page introuvable</h1>
                <Link to="/accueil">Retour à l’accueil</Link>
              </div>
            }
          />
        </Routes>
      </BrowserRouter>
    </SessionProvider>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

registerSearch();
