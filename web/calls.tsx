import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from "react";
import { PhoneOff, Mic, Video, Volume2 } from "lucide-react";
import { api, socket, useSession, useData, Status, Pager } from "./lib";

const Calls = createContext({ start: (_room: string, _video: boolean) => {} });
export const useCalls = () => useContext(Calls);

function mediaError(error: unknown, video: boolean) {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError") return `L’accès ${video ? "à la caméra ou au microphone" : "au microphone"} a été refusé.`;
  if (name === "NotFoundError") return video ? "Aucune caméra ou aucun microphone disponible." : "Aucun microphone disponible.";
  if (name === "NotReadableError") return "Votre appareil multimédia est déjà utilisé par une autre application.";
  if (name === "OverconstrainedError") return "Votre appareil ne prend pas en charge les réglages demandés.";
  if (name === "AbortError") return "L’ouverture de votre appareil multimédia a été interrompue.";
  return error instanceof Error ? error.message : "Impossible d’accéder à votre appareil multimédia.";
}

export function CallProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const [call, setCall] = useState<any>(null), [error, setError] = useState(""), [mic, setMic] = useState(true), [cam, setCam] = useState(true), [duration, setDuration] = useState(0), [connection, setConnection] = useState("idle"), [ringBlocked, setRingBlocked] = useState(false);
  const current = useRef<any>(null), pc = useRef<RTCPeerConnection | null>(null), localStream = useRef<MediaStream | null>(null), remoteStream = useRef<MediaStream | null>(null), remoteVideo = useRef<HTMLVideoElement>(null), remoteAudio = useRef<HTMLAudioElement>(null), localVideo = useRef<HTMLVideoElement>(null), ringtone = useRef<HTMLAudioElement>(null), candidates = useRef<RTCIceCandidateInit[]>([]), connectedAt = useRef<number | null>(null);
  function update(next: any) { current.current = next ? { ...current.current, ...next } : null; setCall(current.current); }
  function stopRingtone() { if (ringtone.current) { ringtone.current.pause(); ringtone.current.currentTime = 0; } setRingBlocked(false); }
  async function playRingtone() { if (!ringtone.current) return; try { ringtone.current.currentTime = 0; await ringtone.current.play(); setRingBlocked(false); } catch { setRingBlocked(true); } }
  function cleanup() { stopRingtone(); pc.current?.close(); pc.current = null; localStream.current?.getTracks().forEach((track) => track.stop()); localStream.current = null; remoteStream.current = null; candidates.current = []; connectedAt.current = null; setDuration(0); setConnection("idle"); }
  function attachRemote() {
    if (remoteVideo.current) remoteVideo.current.srcObject = remoteStream.current;
    if (remoteAudio.current) remoteAudio.current.srcObject = remoteStream.current;
    void remoteVideo.current?.play().catch(() => {});
    void remoteAudio.current?.play().catch(() => setError("Touchez l’écran pour activer le son de votre correspondant."));
  }
  async function prepare(video: boolean) {
    const config = await api("/calls/config");
    if (!config.configured) throw new Error("Le service d’appels n’est pas encore configuré.");
    let captured: MediaStream;
    try { captured = await navigator.mediaDevices.getUserMedia({ audio: true, video }); } catch (e) { throw new Error(mediaError(e, video), { cause: e }); }
    if (!captured.getAudioTracks().length || (video && !captured.getVideoTracks().length)) { captured.getTracks().forEach((track) => track.stop()); throw new Error(video ? "La caméra et le microphone sont requis pour cet appel." : "Le microphone est requis pour cet appel."); }
    localStream.current = captured; remoteStream.current = new MediaStream();
    const peer = new RTCPeerConnection({ iceServers: config.iceServers }); pc.current = peer;
    captured.getTracks().forEach((track) => peer.addTrack(track, captured));
    peer.ontrack = (event) => { if (event.streams[0]) remoteStream.current = event.streams[0]; else if (!remoteStream.current!.getTracks().some((track) => track.id === event.track.id)) remoteStream.current!.addTrack(event.track); attachRemote(); };
    peer.onicecandidate = (event) => { if (event.candidate && current.current) socket.emit("signal", { callId: current.current.id, type: "ice", data: event.candidate.toJSON() }); };
    const syncState = () => {
      const state = peer.connectionState, ice = peer.iceConnectionState;
      if (state === "connected" || ice === "connected" || ice === "completed") { setConnection("connected"); if (!connectedAt.current) { connectedAt.current = Date.now(); void api(`/calls/${current.current?.id}/connected`, "POST", {}).catch(() => {}); } }
      else if (state === "failed" || ice === "failed") { setConnection("failed"); setError("La connexion média a échoué. Vérifiez votre réseau puis réessayez."); }
      else if (state === "disconnected") setConnection("disconnected"); else if (state !== "closed") setConnection("connecting");
    };
    peer.onconnectionstatechange = syncState; peer.oniceconnectionstatechange = syncState;
    setMic(true); setCam(true); setConnection("preparing");
    setTimeout(() => { if (localVideo.current) localVideo.current.srcObject = captured; }, 0);
  }
  async function finish(state: "ENDED" | "DECLINED" | "CANCELLED" = "ENDED") { const active = current.current; if (active) await api(`/calls/${active.id}/state`, "POST", { state }).catch(() => {}); cleanup(); update(null); }
  async function start(roomId: string, video: boolean) { setError(""); try { await prepare(video); update(await api("/calls", "POST", { roomId, video })); setConnection("ringing"); } catch (e) { cleanup(); setError((e as Error).message); } }
  async function accept() { stopRingtone(); try { await prepare(current.current.video); update(await api(`/calls/${current.current.id}/state`, "POST", { state: "ACCEPTED" })); setConnection("connecting"); } catch (e) { setError((e as Error).message); await finish("DECLINED"); } }
  useEffect(() => {
    const incoming = async (next: any) => {
      if (current.current && next.id !== current.current.id) return;
      if (["ENDED", "DECLINED", "MISSED", "CANCELLED", "FAILED"].includes(next.state)) { cleanup(); update(null); return; }
      update(next);
      if (next.state === "RINGING" && next.calleeId === user?.id) { setConnection("ringing"); void playRingtone(); } else stopRingtone();
      if (next.state === "ACCEPTED" && next.callerId === user?.id && pc.current) { setConnection("connecting"); const offer = await pc.current.createOffer(); await pc.current.setLocalDescription(offer); socket.emit("signal", { callId: next.id, type: "offer", data: offer }); }
    };
    const signal = async (signal: any) => {
      try { if (signal.callId !== current.current?.id || !pc.current) return; const peer = pc.current;
        if (signal.type === "ice") { if (peer.remoteDescription) await peer.addIceCandidate(signal.data); else candidates.current.push(signal.data); return; }
        await peer.setRemoteDescription(signal.data); for (const candidate of candidates.current) await peer.addIceCandidate(candidate); candidates.current = [];
        if (signal.type === "offer") { const answer = await peer.createAnswer(); await peer.setLocalDescription(answer); socket.emit("signal", { callId: signal.callId, type: "answer", data: answer }); }
      } catch { setConnection("failed"); setError("La négociation sécurisée de l’appel a échoué."); }
    };
    socket.on("call", incoming); socket.on("signal", signal);
    return () => { socket.off("call", incoming); socket.off("signal", signal); cleanup(); };
  }, [user?.id]);
  useEffect(() => { if (connection !== "connected") return; const tick = () => setDuration(Math.floor((Date.now() - (connectedAt.current || Date.now())) / 1000)); tick(); const timer = setInterval(tick, 1000); return () => clearInterval(timer); }, [connection]);
  useEffect(() => { if (localVideo.current && localStream.current) localVideo.current.srcObject = localStream.current; attachRemote(); }, [call]);
  async function switchCamera() { try { const old = localStream.current?.getVideoTracks()[0]; if (!old) return; const facing = old.getSettings().facingMode === "environment" ? "user" : "environment"; const fresh = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing } }); const track = fresh.getVideoTracks()[0]; await pc.current?.getSenders().find((sender) => sender.track?.kind === "video")?.replaceTrack(track); old.stop(); localStream.current!.removeTrack(old); localStream.current!.addTrack(track); if (localVideo.current) localVideo.current.srcObject = localStream.current; } catch { setError("Changement de caméra indisponible."); } }
  const isIncoming = call?.state === "RINGING" && call.calleeId === user?.id;
  const status = connection === "connected" ? `${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, "0")}` : connection === "ringing" ? "Sonnerie…" : connection === "failed" ? "Échec de connexion" : "Connexion…";
  return <Calls.Provider value={{ start: (room, video) => void start(room, video) }}>
    {children}<audio ref={ringtone} src="/ringtone.wav" preload="auto" loop />
    {error && <div className="toast" role="alert">{error}<button onClick={() => setError("")}>Fermer</button></div>}
    {call && <div className="call-overlay" role="dialog" aria-modal="true" aria-label="Appel"><div className="call-panel" onClick={() => { if (ringBlocked) void playRingtone(); else { void remoteAudio.current?.play(); void remoteVideo.current?.play(); } }}>
      <span className="eyebrow">PLANÈTE LIBIA AI</span><h2>{isIncoming ? "Appel entrant" : connection === "connected" ? "Appel en cours" : "Appel en attente"}</h2><h3>{call.callerId === user?.id ? call.callee?.name : call.caller?.name}</h3><p>{call.video ? "Appel vidéo" : "Appel audio"} · {status}</p>
      {ringBlocked && <p className="notice"><Volume2 size={18} /> Touchez l’écran pour activer la sonnerie.</p>}
      <video ref={remoteVideo} autoPlay playsInline className="remote-video" /><audio ref={remoteAudio} autoPlay /><video ref={localVideo} autoPlay playsInline muted className="local-video" />
      {isIncoming ? <div className="actions"><button className="gold" onClick={(event) => { event.stopPropagation(); void accept(); }}>Répondre</button><button onClick={(event) => { event.stopPropagation(); void finish("DECLINED"); }}>Refuser</button></div> : <div className="actions"><button onClick={(event) => { event.stopPropagation(); localStream.current?.getAudioTracks().forEach((track) => { track.enabled = !mic; }); setMic(!mic); }}><Mic />{mic ? "Couper le micro" : "Activer le micro"}</button>{call.video && <><button onClick={(event) => { event.stopPropagation(); localStream.current?.getVideoTracks().forEach((track) => { track.enabled = !cam; }); setCam(!cam); }}><Video />{cam ? "Couper la caméra" : "Activer la caméra"}</button><button onClick={(event) => { event.stopPropagation(); void switchCamera(); }}>Changer de caméra</button></>}</div>}
      {!isIncoming && <button className="danger" onClick={(event) => { event.stopPropagation(); void finish(call.state === "RINGING" ? "CANCELLED" : "ENDED"); }}><PhoneOff />Terminer</button>}
    </div></div>}
  </Calls.Provider>;
}

export function CallHistory() {
  const [page, setPage] = useState(1); const data = useData(`/calls?page=${page}`);
  return <><h1>Vos appels</h1><p className="subtitle">Lancez un appel depuis une discussion privée.</p><Status {...data} />{data.data?.map((call: any) => <div className="list-row" key={call.id}><span>{call.video ? "Appel vidéo" : "Appel audio"}<small>{call.caller?.name} → {call.callee?.name}</small><small>{new Date(call.createdAt).toLocaleString("fr")}{call.durationSeconds != null ? ` · ${call.durationSeconds} s` : ""}</small></span><b>{call.state}</b></div>)}{!data.loading && !data.data?.length && <div className="empty">Aucun appel pour le moment.</div>}<Pager page={page} setPage={setPage} count={data.data?.length || 0} /></>;
}
