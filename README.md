# Glacerie — Alain Ducasse
### Suivi des carapines glacées · Inventaire · Commandes · Traçabilité · PDF

---

## Stack technique

| Couche    | Techno                                      |
|-----------|---------------------------------------------|
| Frontend  | React 18 + Vite                             |
| Backend   | Node.js + Express                           |
| IA        | Claude API (claude-sonnet-4-6, vision)      |
| Météo     | Open-Meteo (gratuit, sans clé)              |
| PDF       | jsPDF (chargé depuis CDN)                   |
| Stockage  | Upstash Redis (persistant) ou JSON local    |

---

## Installation

### 1. Cloner le repo

```bash
git clone https://github.com/TON_USERNAME/OutilGlaceAD.git
cd OutilGlaceAD
```

### 2. Installer les dépendances

```bash
npm install
```

### 3. Configurer les variables d'environnement

```bash
cp .env.example .env
```

Ouvrez `.env` et renseignez les valeurs :

```
ANTHROPIC_API_KEY=sk-ant-...          # Clé Anthropic (OCR étiquettes)
UPSTASH_REDIS_REST_URL=https://...    # URL REST Upstash Redis
UPSTASH_REDIS_REST_TOKEN=AXxx...      # Token REST Upstash Redis
VITE_USE_SERVER_STORAGE=true
APP_COOKIE_SECRET=<chaine-aleatoire-64-chars>
APP_ACCOUNTS=[{"id":"...","name":"...","password":"...","role":"responsable"}]
```

> Upstash : compte gratuit sur https://upstash.com → New Database → Redis → copier REST URL et Token

---

## Lancer en local

### Option A — Double-clic sur `lancer.bat` (Windows)

Le script installe les dépendances, build le frontend, ouvre le navigateur et démarre le serveur.

### Option B — Terminal

```bash
npm run start:local
# Build le frontend puis lance le serveur
# → http://localhost:3000
```

### Option C — Développement (hot reload)

```bash
# Terminal 1 — Backend Express
node server.js

# Terminal 2 — Frontend Vite
npm run dev
# → http://localhost:5173  (proxy /api → port 3000)
```

---

## Rôles utilisateurs

| Rôle          | Accès                                                      |
|---------------|------------------------------------------------------------|
| `responsable` | Tous les onglets + suppression de documents                |
| `adjoint`     | Inventaire, livraisons, traçabilité, espace Production     |
| `equipier`    | Inventaire, livraisons, traçabilité, températures          |

---

## Persistance des données

Les données sont stockées dans **Upstash Redis** (clé-valeur REST) :
- Inventaire, snapshot livraison, suggestions IA
- Traçabilité, relevés de températures
- Documents PDF partagés (Dropbox interne)
- Historique des actions

Sans Upstash configuré, le serveur utilise un fichier `.store.json` local (données perdues au redémarrage).

---

## Déployer sur Railway

1. Créez un compte sur https://railway.app
2. **New Project → Deploy from GitHub Repo** → sélectionnez ce repo
3. Dans **Variables**, ajoutez toutes les variables du `.env.example`
4. **Build Command** : `npm run build` · **Start Command** : `npm start`
5. Railway génère une URL publique → partagez-la à l'équipe

> Chaque `git push` redéploie automatiquement l'app.

---

## Structure du projet

```
OutilGlaceAD/
├── src/
│   ├── App.jsx          # Application React principale
│   ├── main.jsx         # Point d'entrée React
│   └── storage.js       # Adaptateur serveur / localStorage
├── public/
│   └── favicon.svg
├── server.js            # Express : auth, stockage, API IA, Dropbox PDF
├── lancer.bat           # Lanceur Windows (double-clic)
├── index.html
├── vite.config.js
├── package.json
├── .env.example         # Template de configuration (à copier en .env)
├── .gitignore
└── README.md
```

---

## Notes importantes

- **Ne committez jamais `.env`** — les mots de passe et clés API doivent rester secrets (déjà dans `.gitignore`)
- Le fichier `.store.json` (fallback local) est ignoré par Git
- En production, configurez Upstash pour une persistance entre redéploiements

---

*Alain Ducasse Manufacture de Glace — usage interne*
