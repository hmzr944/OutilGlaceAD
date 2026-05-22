import express      from "express";
import cors         from "cors";
import fetch        from "node-fetch";
import rateLimit    from "express-rate-limit";
import cookieParser from "cookie-parser";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync, writeFileSync, existsSync } from "fs";
import "dotenv/config";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app  = express();
const PORT = process.env.PORT || 3000;

/* ─── Secret de signature des cookies ─────────────────────────────
   Définissez APP_COOKIE_SECRET dans Render > Environment Variables
   (valeur aléatoire longue, ex: openssl rand -hex 32)
────────────────────────────────────────────────────────────────── */
const COOKIE_SECRET = process.env.APP_COOKIE_SECRET || "glacerie-dev-secret-change-in-production";

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "12mb" })); // 12 MB pour les PDF base64
app.use(cookieParser(COOKIE_SECRET));

/* ═══════════════════════════════════════════════════
   COMPTES UTILISATEURS
   Chargés depuis APP_ACCOUNTS (tableau JSON) dans Render.
   Format :
   [{"id":"marie","name":"Marie","password":"xxx","role":"responsable"}, ...]
   Rôles : "equipier" | "adjoint" | "responsable"
═══════════════════════════════════════════════════ */
const getAccounts = () => {
  try {
    const raw = process.env.APP_ACCOUNTS || "[]";
    return JSON.parse(raw);
  } catch {
    console.error("⚠ APP_ACCOUNTS invalide — vérifiez le JSON dans Render");
    return [];
  }
};

/* ─── Routes publiques (avant requireAuth) ──────── */

// POST /api/login
app.post("/api/login", (req, res) => {
  const { id, password } = req.body || {};
  if (!id || !password) return res.status(400).json({ error: "Identifiant et mot de passe requis." });

  const account = getAccounts().find(a => a.id === id && a.password === password);
  if (!account) return res.status(401).json({ error: "Identifiant ou mot de passe incorrect." });

  const session = { id: account.id, name: account.name, role: account.role };
  res.cookie("gl_session", JSON.stringify(session), {
    signed:   true,
    httpOnly: true,
    maxAge:   8 * 60 * 60 * 1000,   // 8 heures
    sameSite: "strict",
    secure:   process.env.NODE_ENV === "production",
  });
  res.json({ user: session });
});

// POST /api/logout
app.post("/api/logout", (req, res) => {
  res.clearCookie("gl_session");
  res.json({ ok: true });
});

// GET /api/me — restaure une session existante
app.get("/api/me", (req, res) => {
  const raw = req.signedCookies?.gl_session;
  if (!raw) return res.status(401).json({ error: "Non connecté" });
  try {
    const session = JSON.parse(raw);
    res.json({ user: session });
  } catch {
    res.clearCookie("gl_session");
    res.status(401).json({ error: "Session invalide" });
  }
});

// GET /api/status — accessible sans auth
app.get("/api/status", (req, res) => {
  res.json({ storage: USE_UPSTASH ? "upstash" : "file", uptime: process.uptime() });
});

/* ─── Middleware requireAuth ─────────────────────── */
const requireAuth = (req, res, next) => {
  const raw = req.signedCookies?.gl_session;
  if (!raw) {
    console.warn(`⚠ Auth requis sur ${req.method} ${req.path} — cookie absent ou invalide`);
    return res.status(401).json({ error: "Non connecté — veuillez vous connecter." });
  }
  try {
    req.user = JSON.parse(raw);
    next();
  } catch {
    res.clearCookie("gl_session");
    res.status(401).json({ error: "Session invalide." });
  }
};

/* ═══════════════════════════════════════════════════
   STOCKAGE — Upstash Redis (persistant) ou fichier JSON (local)

   Pour activer Upstash (recommandé sur Render) :
   1. Créez un compte gratuit sur https://upstash.com
   2. Créez une base Redis "glacerie"
   3. Copiez REST URL et REST Token
   4. Ajoutez dans Render Environment Variables :
      UPSTASH_REDIS_REST_URL=https://...
      UPSTASH_REDIS_REST_TOKEN=AXxx...

   Sans Upstash : stockage fichier local (données perdues au redéploiement)
═══════════════════════════════════════════════════ */
const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const USE_UPSTASH   = !!(UPSTASH_URL && UPSTASH_TOKEN);

if (USE_UPSTASH) {
  console.log("✓ Stockage : Upstash Redis (persistant)");
} else {
  console.log("⚠ Stockage : fichier JSON local (données perdues au redéploiement — configurez Upstash)");
}

/* ─── Upstash REST helper ── */
const upstash = async (...cmd) => {
  const res = await fetch(UPSTASH_URL, {
    method:  "POST",
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, "Content-Type": "application/json" },
    body:    JSON.stringify(cmd),
  });
  if (!res.ok) throw new Error(`Upstash ${res.status}`);
  const d = await res.json();
  return d.result;
};

/* ─── File JSON fallback ── */
const STORE_PATH   = join(__dirname, ".store.json");
const HISTORY_PATH = join(__dirname, ".history.json");
const readJSON   = (p, fb) => { try { return existsSync(p) ? JSON.parse(readFileSync(p,"utf8")) : fb; } catch { return fb; } };
const writeJSON  = (p, d)  => { try { writeFileSync(p, JSON.stringify(d, null, 2), "utf8"); } catch(e) { console.error("Write:",e.message); } };

/* ─── Storage helpers ── */
const PREFIX = "glacerie:";

const storeGet = async (key) => {
  if (USE_UPSTASH) {
    try { return await upstash("GET", PREFIX + key); }
    catch (e) { console.error(`Upstash GET failed for ${key}, fallback fichier:`, e.message); }
  }
  return readJSON(STORE_PATH, {})[key] ?? null;
};
const storeSet = async (key, value) => {
  if (USE_UPSTASH) {
    try { await upstash("SET", PREFIX + key, value); return; }
    catch (e) { console.error(`Upstash SET failed for ${key}, fallback fichier:`, e.message); }
  }
  const s = readJSON(STORE_PATH, {}); s[key] = value; writeJSON(STORE_PATH, s);
};
const storeDel = async (key) => {
  if (USE_UPSTASH) {
    try { await upstash("DEL", PREFIX + key); return; }
    catch (e) { console.error(`Upstash DEL failed for ${key}, fallback fichier:`, e.message); }
  }
  const s = readJSON(STORE_PATH, {}); delete s[key]; writeJSON(STORE_PATH, s);
};
const storeListKeys = async (prefix) => {
  if (USE_UPSTASH) {
    try {
      const keys = await upstash("KEYS", PREFIX + prefix + "*");
      return (keys || []).map(k => k.replace(PREFIX, ""));
    } catch (e) { console.error(`Upstash KEYS failed for ${prefix}, fallback fichier:`, e.message); }
  }
  return Object.keys(readJSON(STORE_PATH, {})).filter(k => k.startsWith(prefix));
};

/* ─── History helpers ── */
const HIST_KEY = PREFIX + "history";
const MAX_HIST = 500;

const histGet = async (limit = 100) => {
  if (USE_UPSTASH) {
    try {
      const items = await upstash("LRANGE", HIST_KEY, 0, limit - 1);
      return (items || []).map(i => { try { return JSON.parse(i); } catch { return null; } }).filter(Boolean);
    } catch (e) { console.error("Upstash LRANGE failed, fallback fichier:", e.message); }
  }
  return readJSON(HISTORY_PATH, []).slice(-limit).reverse();
};
const histPush = async (entry) => {
  if (USE_UPSTASH) {
    try {
      await upstash("LPUSH", HIST_KEY, JSON.stringify(entry));
      await upstash("LTRIM", HIST_KEY, 0, MAX_HIST - 1);
      return;
    } catch (e) { console.error("Upstash LPUSH failed, fallback fichier:", e.message); }
  }
  const h = readJSON(HISTORY_PATH, []);
  h.push(entry);
  if (h.length > MAX_HIST) h.splice(0, h.length - MAX_HIST);
  writeJSON(HISTORY_PATH, h);
};
const histDelete = async (id) => {
  if (USE_UPSTASH) {
    try {
      const items = await upstash("LRANGE", HIST_KEY, 0, -1);
      const filtered = (items || []).filter(i => { try { return JSON.parse(i).id !== id; } catch { return true; } });
      await upstash("DEL", HIST_KEY);
      if (filtered.length) await upstash("RPUSH", HIST_KEY, ...filtered);
      return;
    } catch (e) { console.error("Upstash histDelete failed, fallback fichier:", e.message); }
  }
  const h = readJSON(HISTORY_PATH, []).filter(e => String(e.id) !== String(id));
  writeJSON(HISTORY_PATH, h);
};

/* ═══════════════════════════════════════════════════
   API ROUTES PROTÉGÉES (requireAuth sur toutes)
═══════════════════════════════════════════════════ */

// GET /api/storage/:key
app.get("/api/storage/:key", requireAuth, async (req, res) => {
  try {
    const value = await storeGet(req.params.key);
    if (value === null || value === undefined) return res.status(404).json({ error: "Not found" });
    res.json({ key: req.params.key, value });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/storage/list/:prefix
app.get("/api/storage/list/:prefix", requireAuth, async (req, res) => {
  try { res.json({ keys: await storeListKeys(req.params.prefix) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/storage/:key
app.post("/api/storage/:key", requireAuth, async (req, res) => {
  try {
    await storeSet(req.params.key, req.body.value);
    res.json({ key: req.params.key, value: req.body.value });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/history
app.get("/api/history", requireAuth, async (req, res) => {
  try { res.json(await histGet(100)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/history
app.post("/api/history", requireAuth, async (req, res) => {
  const entry = {
    id:        Date.now(),
    type:      req.body.type   || "action",
    label:     req.body.label  || "",
    author:    req.body.author || req.user?.name || "Équipe",
    data:      req.body.data   || null,
    createdAt: new Date().toISOString(),
  };
  try { await histPush(entry); res.json(entry); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/history/:id
app.delete("/api/history/:id", requireAuth, async (req, res) => {
  try { await histDelete(+req.params.id); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

/* ─── Rate limiting IA — 20 appels max / heure / IP ── */
const aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: "Trop de requêtes IA — réessayez dans une heure." },
});

// Proxy Anthropic
app.post("/api/anthropic", requireAuth, aiLimiter, async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY manquante dans les variables d'environnement Render" });
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method:  "POST",
      headers: { "Content-Type":"application/json", "x-api-key":apiKey, "anthropic-version":"2023-06-01" },
      body: JSON.stringify(req.body),
    });
    res.status(response.status).json(await response.json());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ═══════════════════════════════════════════════════
   DROPBOX — PDFs partagés (adjoint + responsable)
═══════════════════════════════════════════════════ */

// POST /api/dropbox — enregistrer un PDF
app.post("/api/dropbox", requireAuth, async (req, res) => {
  const { title, docType, week, pdfBase64, destination } = req.body || {};
  if (!pdfBase64) return res.status(400).json({ error: "pdfBase64 requis" });

  const id = `dropbox_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
  const entry = {
    id,
    title:       title       || "Document",
    docType:     docType     || "other",
    week:        week        || "",
    destination: destination || "responsable",
    author:      req.user.name,
    authorId:    req.user.id,
    createdAt:   new Date().toISOString(),
    pdfBase64,
  };
  try {
    await storeSet(id, JSON.stringify(entry));
    console.log(`✓ Document enregistré : ${id} (${docType}) → ${destination} par ${req.user.name}`);
    res.json({ ok: true, id });
  } catch (e) {
    console.error(`✗ Erreur enregistrement document ${id}:`, e.message);
    res.status(500).json({ error: `Erreur stockage : ${e.message}` });
  }
});

// GET /api/dropbox — liste des documents (sans pdfBase64)
// Responsable : voit tout. Adjoint : voit uniquement les docs destination="adjoint".
app.get("/api/dropbox", requireAuth, async (req, res) => {
  try {
    const keys = await storeListKeys("dropbox_");
    const entries = [];
    for (const key of keys) {
      const val = await storeGet(key);
      if (val) {
        try {
          const { pdfBase64: _, ...meta } = JSON.parse(val);
          if (req.user.role === "adjoint" && meta.destination !== "adjoint") continue;
          entries.push(meta);
        } catch {}
      }
    }
    entries.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(entries);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/dropbox/:id — téléchargement avec pdfBase64
app.get("/api/dropbox/:id", requireAuth, async (req, res) => {
  try {
    const val = await storeGet(req.params.id);
    if (!val) return res.status(404).json({ error: "Document introuvable" });
    res.json(JSON.parse(val));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/dropbox/:id — responsable uniquement
app.delete("/api/dropbox/:id", requireAuth, async (req, res) => {
  if (req.user.role !== "responsable") {
    return res.status(403).json({ error: "Suppression réservée au responsable." });
  }
  try {
    await storeDel(req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ─── Frontend ── */
const distPath = join(__dirname, "dist");
if (!existsSync(distPath)) {
  console.error("\n❌  dist/ introuvable — lance d'abord : npm run build\n");
  process.exit(1);
}
app.use(express.static(distPath));
app.get("*", (_req, res) => res.sendFile(join(distPath, "index.html")));

app.listen(PORT, () => {
  console.log(`\n✓ Glacerie Ducasse — http://localhost:${PORT}`);
  console.log(`  Stockage : ${USE_UPSTASH ? "Upstash Redis ✓" : "fichier local ⚠"}\n`);
});
