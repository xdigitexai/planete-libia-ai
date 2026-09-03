import { useState } from "react";
import { api } from "./lib";
export function PushSettings() {
  const [status, setStatus] = useState("");
  async function enable() {
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window))
        throw new Error(
          "Ce navigateur ne prend pas en charge les notifications push.",
        );
      const c = await api("/push/config");
      if (!c.configured)
        throw new Error("Le service push n’est pas encore configuré.");
      if ((await Notification.requestPermission()) !== "granted")
        throw new Error("Autorisation de notification refusée.");
      const r = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const key = Uint8Array.from(
        atob(c.publicKey.replace(/-/g, "+").replace(/_/g, "/")),
        (x) => x.charCodeAt(0),
      );
      const subscription = await r.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key,
      });
      await api("/push/subscribe", "POST", subscription.toJSON());
      setStatus("Notifications activées sur cet appareil.");
    } catch (e) {
      setStatus((e as Error).message);
    }
  }
  async function disable() {
    try {
      const r = await navigator.serviceWorker.getRegistration();
      const s = await r?.pushManager.getSubscription();
      if (s) {
        await api("/push/unsubscribe", "POST", { endpoint: s.endpoint });
        await s.unsubscribe();
      }
      setStatus("Notifications push désactivées.");
    } catch (e) {
      setStatus((e as Error).message);
    }
  }
  return (
    <div>
      <h3>Notifications sur cet appareil</h3>
      <div className="actions">
        <button onClick={() => void enable()}>Activer</button>
        <button onClick={() => void disable()}>Désactiver</button>
      </div>
      <p role="status">{status}</p>
    </div>
  );
}
