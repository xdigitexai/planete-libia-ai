import { useState, useEffect, useRef } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import {
  MessageCircle,
  Plus,
  Send,
  Paperclip,
  Mic,
  Phone,
  Video,
  Sparkles,
  Settings,
  Search,
} from "lucide-react";
import {
  api,
  useData,
  useSession,
  Status,
  Avatar,
  Form,
  Field,
  Pager,
  socket,
  upload,
} from "./lib";
import { useCalls } from "./calls";
export function Discussions() {
  const [page, setPage] = useState(1);
  const d = useData(`/rooms?page=${page}`);
  const { user } = useSession();
  useEffect(() => {
    const update = () => d.reload();
    socket.on("message", update);
    socket.on("receipt", update);
    return () => {
      socket.off("message", update);
      socket.off("receipt", update);
    };
  }, []);
  return (
    <>
      <div className="section-heading">
        <div>
          <span className="eyebrow">RESTONS CONNECTÉS</span>
          <h1>Discussions</h1>
        </div>
        <Link className="button gold" to="/contacts">
          <Plus size={18} />
          Nouveau
        </Link>
      </div>
      <div className="actions">
        <Link className="button" to="/groupes/nouveau">
          Créer un groupe
        </Link>
        <Link className="button" to="/contacts">
          Mes contacts
        </Link>
      </div>
      <Status {...d} />
      {d.data?.map((room: any) => {
        const other = room.members.find(
          (m: any) => m.userId !== user?.id,
        )?.user;
        return (
          <Link
            className="list-row"
            key={room.id}
            to={`/discussions/${room.id}`}
          >
            <Avatar
              user={
                room.kind === "GROUP"
                  ? { name: room.name, avatarId: room.avatarId }
                  : other || user!
              }
            />
            <span>
              <strong>{room.name || other?.name}</strong>
              <small>{room.messages[0]?.body || "Aucun message"}</small>
            </span>
            <time>{new Date(room.updatedAt).toLocaleDateString("fr")}</time>
            {room.unread > 0 && <b className="badge">{room.unread}</b>}
          </Link>
        );
      })}
      {!d.loading && !d.data?.length && (
        <div className="empty">
          <MessageCircle />
          <h3>Votre prochaine conversation commence ici.</h3>
          <Link to="/contacts">Trouver une personne →</Link>
        </div>
      )}
      <Pager page={page} setPage={setPage} count={d.data?.length || 0} />
    </>
  );
}
export function Chat() {
  const { id } = useParams();
  const { user } = useSession();
  const room = useData(`/rooms/${id}`);
  const [page, setPage] = useState(1);
  const messages = useData(`/rooms/${id}/messages?page=${page}`);
  const calls = useData(`/rooms/${id}/calls`);
  const presence = useData(`/rooms/${id}/presence`);
  const [text, setText] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [media, setMedia] = useState<{ id: string; name: string } | null>(null),
    [typing, setTyping] = useState(""),
    [recording, setRecording] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const { start } = useCalls();
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setPage(1);
    setMedia(null);
    const update = (m: any) => {
      if (m.roomId === id) {
        messages.reload();
        room.reload();
        void api(`/rooms/${id}/delivered`, "POST", {}).catch(() => {});
        if (document.visibilityState === "visible")
          void api(`/rooms/${id}/read`, "POST", {}).catch(() => {});
      }
    };
    const type = (m: any) => {
      if (m.roomId === id) setTyping(m.typing ? "Quelqu’un écrit…" : "");
    };
    const receipt = (m: any) => {
      if (m.roomId === id) room.reload();
    };
    socket.on("message", update);
    socket.on("receipt", receipt);
    socket.on("typing", type);
    const online = () => presence.reload();
    socket.on("presence", online);
    socket.on("call", calls.reload);
    void api(`/rooms/${id}/read`, "POST", {}).catch(() => {});
    const timer = setInterval(() => presence.reload(), 30000);
    return () => {
      socket.off("message", update);
      socket.off("receipt", receipt);
      socket.off("typing", type);
      socket.off("presence", online);
      socket.off("call", calls.reload);
      clearInterval(timer);
      recorder.current?.stream.getTracks().forEach((t) => t.stop());
    };
  }, [id]);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.data]);
  useEffect(() => {
    if (!typing) return;
    const t = setTimeout(() => setTyping(""), 3000);
    return () => clearTimeout(t);
  }, [typing]);
  async function attach(f: File, sendImmediately = false) {
    setBusy(true);
    try {
      const m = await upload(f);
      if (sendImmediately) {
        await api(`/rooms/${id}/messages`, "POST", {
          body: "Message vocal",
          mediaId: m.id,
          clientId: crypto.randomUUID(),
        });
        messages.reload();
      } else setMedia({ ...m, name: f.name });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function voice() {
    if (recording) {
      recorder.current?.stop();
      setRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"].find((type) => MediaRecorder.isTypeSupported(type));
      const r = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      recorder.current = r;
      const chunks: BlobPart[] = [];
      r.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (!chunks.length) { setError("L’enregistrement vocal est vide. Réessayez."); return; }
        const extension = r.mimeType.includes("ogg") ? "ogg" : "webm";
        void attach(new File(chunks, `message-vocal.${extension}`, { type: r.mimeType }), true);
      };
      r.start();
      setRecording(true);
      setTimeout(() => {
        if (r.state === "recording") {
          r.stop();
          setRecording(false);
        }
      }, 60000);
    } catch {
      setError("Autorisez le microphone pour enregistrer un message vocal.");
    }
  }
  async function send() {
    if (!text.trim() && !media) return;
    setBusy(true);
    setError("");
    try {
      await api(`/rooms/${id}/messages`, "POST", {
        body: text,
        mediaId: media?.id,
        clientId: crypto.randomUUID(),
      });
      setText("");
      setMedia(null);
      messages.reload();
      socket.emit("typing", { roomId: id, typing: false });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const other = room.data?.members.find(
    (m: any) => m.userId !== user?.id,
  )?.user;
  return (
    <div className="chat">
      <div className="chat-header">
        <Link to="/discussions">←</Link>
        <Avatar
          user={
            room.data?.kind === "GROUP"
              ? { name: room.data.name, avatarId: room.data.avatarId }
              : other || { name: "…" }
          }
        />
        <div>
          <h2>{room.data?.name || other?.name || "Discussion"}</h2>
          <small>
            {presence.data?.some((p: any) => p.userId !== user?.id && p.online)
              ? "En ligne"
              : "Discussion privée"}
          </small>
        </div>
        {room.data?.kind === "GROUP" ? (
          <Link
            className="button"
            to={`/groupes/${id}`}
            aria-label="Gérer le groupe"
          >
            <Settings size={19} />
          </Link>
        ) : (
          <>
            <button aria-label="Appel audio" onClick={() => start(id!, false)}>
              <Phone size={19} />
            </button>
            <button aria-label="Appel vidéo" onClick={() => start(id!, true)}>
              <Video size={19} />
            </button>
          </>
        )}
      </div>
      <Status
        error={room.error || messages.error || error}
        loading={room.loading}
      />
      <div className="messages">
        <Pager
          page={page}
          setPage={setPage}
          count={messages.data?.length || 0}
        />
        {messages.data
          ?.slice()
          .reverse()
          .map((m: any) => (
            <div
              key={m.id}
              className={`message ${m.senderId === user?.id ? "mine" : ""}`}
            >
              <small>{m.sender.name}</small>
              <p>{m.body}</p>
              {m.media &&
                (m.media.mime.startsWith("image/") ? (
                  <a
                    href={`/api/media/${m.media.id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <img
                      className="attachment"
                      src={`/api/media/${m.media.id}`}
                      alt={m.media.name}
                    />
                  </a>
                ) : m.media.mime.startsWith("audio/") ||
                  m.media.mime === "video/webm" ? (
                  <audio controls src={`/api/media/${m.media.id}`} />
                ) : (
                  <a href={`/api/media/${m.media.id}`}>📎 {m.media.name}</a>
                ))}
              <time>
                {new Date(m.createdAt).toLocaleTimeString("fr", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}{" "}
                {m.senderId === user?.id &&
                  (room.data?.members
                    .filter((v: any) => v.userId !== user?.id)
                    .every(
                      (v: any) => new Date(v.readAt) >= new Date(m.createdAt),
                    )
                    ? "· Lu"
                    : room.data?.members.some(
                          (v: any) =>
                            v.userId !== user?.id &&
                            new Date(v.deliveredAt) >= new Date(m.createdAt),
                        )
                      ? "· Distribué"
                      : "· Envoyé")}
              </time>
            </div>
          ))}
        {calls.data?.map((c: any) => (
          <div className="message call-event" key={`call-${c.id}`}>
            <strong>{c.video ? "Appel vidéo" : "Appel audio"}</strong>
            <small>{c.state === "MISSED" ? "Appel manqué" : c.state === "DECLINED" ? "Appel refusé" : c.state === "CANCELLED" ? "Appel annulé" : c.state === "ENDED" ? "Appel terminé" : c.state === "CONNECTED" ? "Appel en cours" : "Appel en attente"}{c.durationSeconds != null ? ` · ${c.durationSeconds} s` : ""}</small>
            <time>{new Date(c.createdAt).toLocaleString("fr")}</time>
          </div>
        ))}
        <div ref={end} />
      </div>
      <small className="typing">{typing}</small>
      {media && (
        <div className="notice">
          {media.name}
          <button onClick={() => setMedia(null)}>Retirer</button>
        </div>
      )}
      <div className="composer">
        <input
          ref={file}
          type="file"
          hidden
          onChange={(e) => {
            if (e.target.files?.[0]) void attach(e.target.files[0]);
          }}
        />
        <button
          aria-label="Joindre un fichier"
          onClick={() => file.current?.click()}
        >
          <Paperclip size={20} />
        </button>
        <button
          aria-label={recording ? "Arrêter l’enregistrement" : "Message vocal"}
          className={recording ? "danger" : ""}
          onClick={() => void voice()}
        >
          <Mic size={20} />
        </button>
        <input
          aria-label="Votre message"
          placeholder="Écrivez votre message…"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            socket.emit("typing", { roomId: id, typing: true });
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void send();
          }}
        />
        <button
          onClick={() => setText((t) => t + " 😊")}
          aria-label="Ajouter un sourire"
        >
          ☺
        </button>
        <button
          className="gold"
          disabled={busy}
          onClick={() => void send()}
          aria-label="Envoyer"
        >
          <Send size={20} />
        </button>
      </div>
      <button
        className="subtle"
        onClick={() => {
          const reason = prompt(
            "Expliquez le problème (10 caractères minimum)",
          );
          if (reason)
            void api("/reports", "POST", {
              targetType: room.data?.kind === "GROUP" ? "GROUP" : "USER",
              targetId: room.data?.kind === "GROUP" ? id : other?.id,
              reason,
            })
              .then(() => alert("Signalement envoyé."))
              .catch((e) => setError(e.message));
        }}
      >
        Signaler cette discussion
      </button>
    </div>
  );
}
export function AI() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const list = useData(`/ai/threads?page=${page}`);
  const [messagePage, setMessagePage] = useState(1);
  const thread = useData(
    id ? `/ai/threads/${id}?page=${messagePage}` : "/ai/threads",
  );
  useEffect(() => setMessagePage(1), [id]);
  const [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function send() {
    if (!text.trim()) return;
    setBusy(true);
    setError("");
    try {
      const tid = id || (await api("/ai/threads", "POST", {})).id;
      await api(`/ai/threads/${tid}/messages`, "POST", { content: text });
      setText("");
      navigate(`/ia/${tid}`);
      thread.reload();
      list.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="section-heading">
        <div>
          <span className="eyebrow">VOTRE PARTENAIRE D’IDÉES</span>
          <h1>Planète LIBIA AI</h1>
        </div>
        <button
          onClick={() => {
            navigate("/ia");
            setError("");
          }}
        >
          <Plus size={18} />
          Nouvelle conversation
        </button>
      </div>
      <div className="ai-layout">
        <div className="panel history">
          <h3>Vos conversations</h3>
          <Status {...list} />
          {list.data?.map((t: any) => (
            <div className="history-row" key={t.id}>
              <Link to={`/ia/${t.id}`}>
                {t.title}
                <small>{new Date(t.updatedAt).toLocaleDateString("fr")}</small>
              </Link>
              <button
                aria-label="Supprimer la conversation"
                onClick={async () => {
                  if (confirm("Supprimer cette conversation ?")) {
                    try {
                      await api(`/ai/threads/${t.id}`, "DELETE");
                      list.reload();
                      if (id === t.id) navigate("/ia");
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }
                }}
              >
                ×
              </button>
            </div>
          ))}
          <Pager page={page} setPage={setPage} count={list.data?.length || 0} />
        </div>
        <div className="panel ai-conversation">
          {!id && (
            <div className="ai-welcome">
              <Sparkles size={45} />
              <h2>Comment puis-je vous aider ?</h2>
              <p>Un peu de clarté, une nouvelle idée, un premier brouillon.</p>
              <div className="prompt-grid">
                {[
                  "Aide-moi à rédiger un texte",
                  "Explique-moi un sujet simplement",
                  "Traduis un texte",
                  "Trouvons des idées ensemble",
                ].map((t) => (
                  <button key={t} onClick={() => setText(t)}>
                    {t} ↗
                  </button>
                ))}
              </div>
            </div>
          )}
          {id && <Status {...thread} />}
          {id && (
            <Pager
              page={messagePage}
              setPage={setMessagePage}
              count={thread.data?.messages?.length || 0}
            />
          )}
          <div className="ai-messages">
            {id &&
              thread.data?.messages
                ?.slice()
                .sort(
                  (a: any, b: any) =>
                    new Date(a.createdAt).getTime() -
                    new Date(b.createdAt).getTime(),
                )
                .map((m: any) => (
                  <div
                    className={`message ${m.role === "user" ? "mine" : ""}`}
                    key={m.id}
                  >
                    <small>
                      {m.role === "user" ? "Vous" : "PLANÈTE LIBIA AI"}
                    </small>
                    <p>{m.content}</p>
                  </div>
                ))}
          </div>
          <Status error={error} />
          {busy && <p role="status">L’IA prépare sa réponse…</p>}
          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <input
              aria-label="Votre demande à l’IA"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Posez votre question…"
            />
            <button
              className="gold"
              disabled={busy || !text.trim()}
              aria-label="Envoyer à l’IA"
            >
              <Send size={20} />
            </button>
          </form>
          <small className="muted">
            L’IA peut se tromper. Vérifiez les informations importantes.
          </small>
        </div>
      </div>
    </>
  );
}
export function People() {
  const [q, setQ] = useState(""),
    [page, setPage] = useState(1),
    [error, setError] = useState("");
  const d = useData(`/users?q=${encodeURIComponent(q)}&page=${page}`);
  const contacts = useData("/contacts");
  const navigate = useNavigate();
  return (
    <>
      <h1>La communauté</h1>
      <p className="subtitle">
        Trouvez vos proches. Faites de nouvelles rencontres.
      </p>
      <label className="search-link">
        <Search size={18} />
        <input
          aria-label="Rechercher une personne"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          placeholder="Nom ou @utilisateur"
        />
      </label>
      <h2>Découvrir</h2>
      <Status error={d.error || error} loading={d.loading} />
      {d.data?.map((u: any) => (
        <div className="list-row" key={u.id}>
          <Avatar user={u} />
          <Link to={`/profil/${u.id}`}>
            <strong>{u.name}</strong>
            <small>@{u.username}</small>
          </Link>
          <button
            onClick={async () => {
              try {
                const room = await api("/rooms/private", "POST", {
                  userId: u.id,
                });
                navigate(`/discussions/${room.id}`);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Discuter
          </button>
          <button
            onClick={async () => {
              try {
                await api(`/contacts/${u.id}`, "POST", {});
                contacts.reload();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Ajouter
          </button>
        </div>
      ))}
      <Pager page={page} setPage={setPage} count={d.data?.length || 0} />
      <h2>Mes contacts</h2>
      {contacts.data?.map((c: any) => (
        <div className="list-row" key={c.targetId}>
          <Avatar user={c.target} />
          <Link to={`/profil/${c.targetId}`}>{c.target.name}</Link>
          <button
            onClick={async () => {
              await api(`/contacts/${c.targetId}`, "DELETE");
              contacts.reload();
            }}
          >
            Retirer
          </button>
        </div>
      ))}
    </>
  );
}
export function Group() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useSession();
  const d = useData(id ? `/rooms/${id}` : "/contacts");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const candidates = useData(`/users?q=${encodeURIComponent(search)}`);
  const role = id
    ? d.data?.members?.find((m: any) => m.userId === user?.id)?.role
    : "OWNER";
  const canManage = role === "OWNER" || role === "ADMIN";
  return (
    <>
      <h1>{id ? "Informations du groupe" : "Créer un groupe"}</h1>
      <Status error={d.error || error} loading={d.loading} />
      {canManage && (
        <div className="panel" key={d.data?.id}>
          <Form
            onSubmit={async (b) => {
              const r = await api(
                id ? `/groups/${id}` : "/groups",
                id ? "PATCH" : "POST",
                b,
              );
              if (!id) navigate(`/groupes/${r.id}`);
              else d.reload();
            }}
            label={id ? "Enregistrer" : "Créer le groupe"}
          >
            <Field
              name="name"
              label="Nom du groupe"
              value={id ? d.data?.name : ""}
            />
            <label>
              Description
              <textarea
                name="description"
                defaultValue={id ? d.data?.description : ""}
              />
            </label>
          </Form>
          {id && (
            <label>
              Photo du groupe
              <input
                type="file"
                accept="image/*"
                onChange={async (e) => {
                  try {
                    if (e.target.files?.[0]) {
                      const f = await upload(e.target.files[0]);
                      await api(`/groups/${id}`, "PATCH", { avatarId: f.id });
                      d.reload();
                    }
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              />
            </label>
          )}
        </div>
      )}
      {id && (
        <>
          <Link className="button gold" to={`/discussions/${id}`}>
            Ouvrir la discussion
          </Link>
          <h2>Membres</h2>
          {d.data?.members?.map((m: any) => (
            <div className="list-row" key={m.userId}>
              <Avatar user={m.user} />
              <span>
                {m.user.name}
                <small>{m.role}</small>
              </span>
              {role === "OWNER" && m.role !== "OWNER" && (
                <button
                  onClick={async () => {
                    await api(`/groups/${id}/members/${m.userId}`, "PATCH", {
                      role: m.role === "ADMIN" ? "MEMBER" : "ADMIN",
                    });
                    d.reload();
                  }}
                >
                  Changer le rôle
                </button>
              )}
              {canManage && m.role !== "OWNER" && (
                <button
                  onClick={async () => {
                    try {
                      await api(`/groups/${id}/members/${m.userId}`, "DELETE");
                      d.reload();
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  Retirer
                </button>
              )}
            </div>
          ))}
          {canManage && (
            <Form
              label="Ajouter un membre"
              onSubmit={async (b) => {
                await api(`/groups/${id}/members`, "POST", b);
                d.reload();
              }}
            >
              <label>
                Rechercher une personne
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Nom ou nom d’utilisateur"
                />
              </label>
              <label>
                Personne à ajouter
                <select name="userId" required>
                  <option value="">Choisir une personne</option>
                  {candidates.data
                    ?.filter(
                      (u: any) =>
                        !d.data?.members?.some((m: any) => m.userId === u.id),
                    )
                    .map((u: any) => (
                      <option key={u.id} value={u.id}>
                        {u.name} (@{u.username})
                      </option>
                    ))}
                </select>
              </label>
            </Form>
          )}
          {role !== "OWNER" && (
            <button
              onClick={async () => {
                if (confirm("Quitter ce groupe ?")) {
                  await api(`/groups/${id}/members/${user!.id}`, "DELETE");
                  navigate("/discussions");
                }
              }}
            >
              Quitter le groupe
            </button>
          )}
        </>
      )}
    </>
  );
}
