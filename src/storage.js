// src/storage.js
const USE_SERVER = import.meta.env.VITE_USE_SERVER_STORAGE === "true";

export const storage = {
  async get(key, shared = false) {
    if (USE_SERVER) {
      try {
        const res = await fetch(`/api/storage/${encodeURIComponent(key)}`);
        if (!res.ok) return null;
        return { value: (await res.json()).value };
      } catch { return null; }
    }
    const value = localStorage.getItem(key);
    return value ? { value } : null;
  },

  async set(key, value, shared = false) {
    if (USE_SERVER) {
      try {
        await fetch(`/api/storage/${encodeURIComponent(key)}`, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ value }),
        });
      } catch (e) { console.error("Storage set error:", e); }
    } else {
      localStorage.setItem(key, value);
    }
  },

  // Liste les clés avec un préfixe (pour les configs partagées)
  async listKeys(prefix) {
    if (USE_SERVER) {
      try {
        const res = await fetch(`/api/storage/list/${encodeURIComponent(prefix)}`);
        if (!res.ok) return [];
        const d = await res.json();
        return d.keys || [];
      } catch { return []; }
    }
    return Object.keys(localStorage).filter(k => k.startsWith(prefix));
  },
};

/* ─── Historique partagé ── */
export const history = {
  async get() {
    try {
      const res = await fetch("/api/history");
      if (!res.ok) { console.error("History get failed:", res.status); return []; }
      return await res.json();
    } catch (e) { console.error("History get error:", e); return []; }
  },

  // Retourne l'entrée créée (avec id/createdAt) si succès, null si échec
  async push({ type, label, author, data }) {
    try {
      const res = await fetch("/api/history", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ type, label, author, data }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error("History push failed:", res.status, err);
        return null;
      }
      return await res.json(); // retourne l'entrée avec id et createdAt
    } catch (e) { console.error("History push error:", e); return null; }
  },

  async remove(id) {
    try {
      const res = await fetch(`/api/history/${id}`, { method: "DELETE" });
      if (!res.ok) console.error("History delete failed:", res.status);
    } catch (e) { console.error("History delete error:", e); }
  },
};
