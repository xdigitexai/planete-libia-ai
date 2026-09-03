import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { PhoneOff, Mic, Video } from "lucide-react";
import { api, socket, useSession, useData, Status, Pager } from "./lib";
const Calls = createContext({ start: (_room: string, _video: boolean) => {} });
export const useCalls = () => useContext(Calls);
export function CallProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const [call, setCall] = useState<any>(null),
    [error, setError] = useState(""),
    [mic, setMic] = useState(true),
    [cam, setCam] = useState(true),
    [duration, setDuration] = useState(0),
    [connection, setConnection] = useState("");
  const current = useRef<any>(null),
    pc = useRef<RTCPeerConnection | null>(null),
    stream = useRef<MediaStream | null>(null),
    remote = useRef<HTMLVideoElement>(null),
    local = useRef<HTMLVideoElement>(null),
    candidates = useRef<RTCIceCandidateInit[]>([]);
  function cleanup() {
    pc.current?.close();
    pc.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    candidates.current = [];
    setConnection("");
  }
  function update(c: any) {
    current.current = c ? { ...current.current, ...c } : null;
    setCall(current.current);
  }
  async function prepare(video: boolean) {
    const config = await api("/calls/config");
    if (!config.configured)
      throw new Error("Le service d’appels n’est pas encore configuré.");
    stream.current = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video,
    });
    const peer = new RTCPeerConnection({ iceServers: config.iceServers });
    pc.current = peer;
    stream.current
      .getTracks()
      .forEach((t) => peer.addTrack(t, stream.current!));
    peer.ontrack = (e) => {
      if (remote.current) remote.current.srcObject = e.streams[0];
    };
    peer.onicecandidate = (e) => {
      if (e.candidate && current.current)
        socket.emit("signal", {
          callId: current.current.id,
          type: "ice",
          data: e.candidate.toJSON(),
        });
    };
    peer.onconnectionstatechange = () => {
      setConnection(peer.connectionState);
      if (peer.connectionState === "failed")
        setError("Connexion interrompue. Terminez l’appel et réessayez.");
    };
    setMic(true);
    setCam(true);
    setTimeout(() => {
      if (local.current) local.current.srcObject = stream.current;
    }, 0);
  }
  async function finish() {
    if (current.current)
      await api(`/calls/${current.current.id}/state`, "POST", {
        state: "ENDED",
      }).catch(() => {});
    cleanup();
    update(null);
  }
  async function start(roomId: string, video: boolean) {
    setError("");
    try {
      await prepare(video);
      const c = await api("/calls", "POST", { roomId, video });
      update(c);
    } catch (e) {
      cleanup();
      setError((e as Error).message);
    }
  }
  async function accept() {
    try {
      await prepare(current.current.video);
      const c = await api(`/calls/${current.current.id}/state`, "POST", {
        state: "ACCEPTED",
      });
      update(c);
    } catch (e) {
      setError((e as Error).message);
      await finish();
    }
  }
  useEffect(() => {
    const incoming = async (c: any) => {
      if (current.current && c.id !== current.current.id) return;
      if (["ENDED", "DECLINED", "MISSED"].includes(c.state)) {
        cleanup();
        update(null);
        return;
      }
      update(c);
      if (c.state === "ACCEPTED" && c.callerId === user?.id && pc.current) {
        const offer = await pc.current.createOffer();
        await pc.current.setLocalDescription(offer);
        socket.emit("signal", { callId: c.id, type: "offer", data: offer });
      }
    };
    const signal = async (s: any) => {
      try {
        if (s.callId !== current.current?.id || !pc.current) return;
        const peer = pc.current;
        if (s.type === "ice") {
          if (peer.remoteDescription) await peer.addIceCandidate(s.data);
          else candidates.current.push(s.data);
          return;
        }
        await peer.setRemoteDescription(s.data);
        for (const candidate of candidates.current)
          await peer.addIceCandidate(candidate);
        candidates.current = [];
        if (s.type === "offer") {
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          socket.emit("signal", {
            callId: s.callId,
            type: "answer",
            data: answer,
          });
        }
      } catch {
        setError("La connexion à l’appel a échoué.");
      }
    };
    socket.on("call", incoming);
    socket.on("signal", signal);
    return () => {
      socket.off("call", incoming);
      socket.off("signal", signal);
      cleanup();
    };
  }, [user?.id]);
  useEffect(() => {
    if (!call?.acceptedAt) return;
    const tick = () =>
      setDuration(
        Math.floor((Date.now() - new Date(call.acceptedAt).getTime()) / 1000),
      );
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [call?.acceptedAt]);
  useEffect(() => {
    if (local.current && stream.current)
      local.current.srcObject = stream.current;
  }, [call]);
  async function switchCamera() {
    try {
      const old = stream.current?.getVideoTracks()[0];
      if (!old) return;
      const facing =
        old.getSettings().facingMode === "environment" ? "user" : "environment";
      const fresh = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing },
      });
      const track = fresh.getVideoTracks()[0];
      await pc.current
        ?.getSenders()
        .find((s) => s.track?.kind === "video")
        ?.replaceTrack(track);
      old.stop();
      stream.current!.removeTrack(old);
      stream.current!.addTrack(track);
      if (local.current) local.current.srcObject = stream.current;
    } catch {
      setError("Changement de caméra indisponible.");
    }
  }
  return (
    <Calls.Provider
      value={{
        start: (r, v) => {
          void start(r, v);
        },
      }}
    >
      {children}
      {error && (
        <div className="toast" role="alert">
          {error}
          <button onClick={() => setError("")}>Fermer</button>
        </div>
      )}
      {call && (
        <div
          className="call-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Appel"
        >
          <div className="call-panel">
            <span className="eyebrow">PLANÈTE LIBIA AI</span>
            <h2>
              {call.state === "RINGING"
                ? "Appel entrant / en attente"
                : "Appel en cours"}
            </h2>
            <h3>
              {call.callerId === user?.id
                ? call.callee?.name
                : call.caller?.name}
            </h3>
            <p>
              {call.state === "ACCEPTED"
                ? `${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, "0")}`
                : "Connexion avec votre contact…"}{" "}
              · {connection}
            </p>
            <video ref={remote} autoPlay playsInline className="remote-video" />
            <video
              ref={local}
              autoPlay
              playsInline
              muted
              className="local-video"
            />
            {call.state === "RINGING" && call.calleeId === user?.id ? (
              <div className="actions">
                <button className="gold" onClick={() => void accept()}>
                  Répondre
                </button>
                <button
                  onClick={async () => {
                    await api(`/calls/${call.id}/state`, "POST", {
                      state: "DECLINED",
                    });
                    cleanup();
                    update(null);
                  }}
                >
                  Refuser
                </button>
              </div>
            ) : (
              <div className="actions">
                <button
                  onClick={() => {
                    stream.current?.getAudioTracks().forEach((t) => {
                      t.enabled = !mic;
                    });
                    setMic(!mic);
                  }}
                >
                  <Mic />
                  {mic ? "Couper le micro" : "Activer le micro"}
                </button>
                {call.video && (
                  <>
                    <button
                      onClick={() => {
                        stream.current?.getVideoTracks().forEach((t) => {
                          t.enabled = !cam;
                        });
                        setCam(!cam);
                      }}
                    >
                      <Video />
                      {cam ? "Couper la caméra" : "Activer la caméra"}
                    </button>
                    <button onClick={() => void switchCamera()}>
                      Changer de caméra
                    </button>
                  </>
                )}
              </div>
            )}
            <button className="danger" onClick={() => void finish()}>
              <PhoneOff />
              Terminer
            </button>
          </div>
        </div>
      )}
    </Calls.Provider>
  );
}
export function CallHistory() {
  const [page, setPage] = useState(1);
  const d = useData(`/calls?page=${page}`);
  return (
    <>
      <h1>Vos appels</h1>
      <p className="subtitle">Lancez un appel depuis une discussion privée.</p>
      <Status {...d} />
      {d.data?.map((c: any) => (
        <div className="list-row" key={c.id}>
          <span>
            {c.video ? "Appel vidéo" : "Appel audio"}
            <small>
              {c.caller?.name} → {c.callee?.name}
            </small>
            <small>{new Date(c.createdAt).toLocaleString("fr")}</small>
          </span>
          <b>{c.state}</b>
        </div>
      ))}
      {!d.loading && !d.data?.length && (
        <div className="empty">Aucun appel pour le moment.</div>
      )}
      <Pager page={page} setPage={setPage} count={d.data?.length || 0} />
    </>
  );
}
