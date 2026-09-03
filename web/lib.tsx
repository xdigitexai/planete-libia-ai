import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
  type FormEvent,
  useId,
} from "react";
import { io, type Socket } from "socket.io-client";
export class ApiError extends Error {
  constructor(
    message: string,
    public details: { field: string; message: string }[] = [],
  ) {
    super(message);
  }
}
const FieldErrors = createContext<Record<string, string[]>>({});
export type User = {
  id: string;
  name: string;
  username: string;
  email: string;
  bio: string;
  role: string;
  avatarId?: string;
  theme: string;
  language: string;
  discoverable: boolean;
  showPresence: boolean;
  totpEnabled: boolean;
  preferences: Record<string, boolean>;
  googleLinked: boolean;
  passwordLogin: boolean;
};
export async function api<T = any>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers:
      body instanceof FormData
        ? { "X-PL-Request": "1" }
        : { "Content-Type": "application/json", "X-PL-Request": "1" },
    body:
      body === undefined
        ? undefined
        : body instanceof FormData
          ? body
          : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok)
    throw new ApiError(
      data.error || "Opération impossible.",
      data.details || [],
    );
  if (
    method === "POST" &&
    path.startsWith("/notifications/") &&
    path.endsWith("/read")
  )
    window.dispatchEvent(new Event("notifications-changed"));
  return data;
}
export const socket: Socket = io({
  autoConnect: false,
  transports: ["websocket"],
});
const Context = createContext<{
  user: User | null;
  refresh: () => Promise<void>;
  loading: boolean;
}>({ user: null, refresh: async () => {}, loading: true });
export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [globalError, setGlobalError] = useState("");
  async function refresh() {
    try {
      const u = await api<User>("/me");
      setUser(u);
      document.documentElement.dataset.theme = u.theme;
      socket.connect();
    } catch {
      setUser(null);
      socket.disconnect();
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
    const rejected = (event: PromiseRejectionEvent) =>
      setGlobalError(
        event.reason instanceof Error
          ? event.reason.message
          : "Une opération a échoué. Réessayez.",
      );
    window.addEventListener("unhandledrejection", rejected);
    return () => {
      window.removeEventListener("unhandledrejection", rejected);
      socket.disconnect();
    };
  }, []);
  return (
    <Context.Provider value={{ user, refresh, loading }}>
      {children}
      {globalError && (
        <div className="toast" role="alert">
          {globalError}
          <button onClick={() => setGlobalError("")}>Fermer</button>
        </div>
      )}
    </Context.Provider>
  );
}
export const useSession = () => useContext(Context);
export function useData<T = any>(path: string) {
  const [data, setData] = useState<T>();
  const [loadedPath, setLoadedPath] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    api<T>(path)
      .then((v) => {
        if (active) {
          setData(v);
          setLoadedPath(path);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [path, version]);
  return {
    data: loadedPath === path ? data : undefined,
    error,
    loading,
    reload: () => setVersion((v) => v + 1),
    setData,
  };
}
export function Status({
  error,
  loading,
}: {
  error?: string;
  loading?: boolean;
}) {
  return error ? (
    <p role="alert" className="notice error">
      {error}
    </p>
  ) : loading ? (
    <p role="status" className="muted">
      Chargement…
    </p>
  ) : null;
}
export function Avatar({
  user,
}: {
  user: { name: string; avatarId?: string | null };
}) {
  return user.avatarId ? (
    <img className="avatar" src={`/api/media/${user.avatarId}`} alt="" />
  ) : (
    <span className="avatar">{user.name.slice(0, 2).toUpperCase()}</span>
  );
}
export function Form({
  children,
  onSubmit,
  label = "Enregistrer",
}: {
  children: ReactNode;
  onSubmit: (data: Record<string, string>) => Promise<unknown>;
  label?: string;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(false);
  const [fields, setFields] = useState<Record<string, string[]>>({});
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const b = Object.fromEntries(new FormData(e.currentTarget)) as Record<
      string,
      string
    >;
    setBusy(true);
    setError("");
    setFields({});
    setSuccess(false);
    try {
      await onSubmit(b);
      setSuccess(true);
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiError) {
        const next: Record<string, string[]> = {};
        for (const issue of e.details)
          (next[issue.field] ??= []).push(issue.message);
        setFields(next);
        const first = form.elements.namedItem(e.details[0]?.field || "");
        if (first instanceof HTMLElement) first.focus();
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <FieldErrors.Provider value={fields}>{children}</FieldErrors.Provider>
      <Status error={error} />
      {success && (
        <p className="notice" role="status">
          Opération effectuée.
        </p>
      )}
      <button className="gold" disabled={busy}>
        {busy ? "Veuillez patienter…" : label}
      </button>
    </form>
  );
}
export function Field({
  name,
  label,
  type = "text",
  value,
  required = true,
  hint,
}: {
  name: string;
  label: string;
  type?: string;
  value?: string;
  required?: boolean;
  hint?: string;
}) {
  const errors = useContext(FieldErrors)[name] || [];
  const id = useId();
  return (
    <label htmlFor={id}>
      {label}
      <input
        id={id}
        name={name}
        type={type}
        defaultValue={value}
        required={required}
        aria-invalid={errors.length > 0}
        aria-describedby={`${id}-help`}
        autoComplete={type === "password" ? "current-password" : undefined}
      />
      <span id={`${id}-help`} className="field-help">
        {hint && <small>{hint}</small>}
        {errors.map((message) => (
          <span key={message} className="field-error">
            {message}
          </span>
        ))}
      </span>
    </label>
  );
}
export function Pager({
  page,
  setPage,
  count,
}: {
  page: number;
  setPage: (p: number) => void;
  count: number;
}) {
  return (
    <div className="pager">
      <button disabled={page === 1} onClick={() => setPage(page - 1)}>
        Précédent
      </button>
      <span>Page {page}</span>
      <button disabled={count < 30} onClick={() => setPage(page + 1)}>
        Suivant
      </button>
    </div>
  );
}
export async function upload(file: File) {
  const f = new FormData();
  f.append("file", file);
  return api<{ id: string }>("/media", "POST", f);
}
export const dictionary = {
  fr: {
    home: "Accueil",
    chats: "Discussions",
    ai: "IA",
    news: "Actualités",
    profile: "Profil",
  },
  en: {
    home: "Home",
    chats: "Chats",
    ai: "AI",
    news: "News",
    profile: "Profile",
  },
};
