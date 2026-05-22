@echo off
title Glacerie — Alain Ducasse
color 0A

echo.
echo  ╔══════════════════════════════════════╗
echo  ║   Glacerie ^| Alain Ducasse           ║
echo  ║   Manufacture de Glace — Paris       ║
echo  ╚══════════════════════════════════════╝
echo.

:: Aller dans le dossier du script
cd /d "%~dp0"

:: ── 1. Verifier Node.js ───────────────────────────────────────
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo  [ERREUR] Node.js n'est pas installe.
    echo.
    echo  Telechargement en cours...
    start https://nodejs.org/dist/v20.19.2/node-v20.19.2-x64.msi
    echo.
    echo  1. Installez Node.js depuis la page qui vient de s'ouvrir
    echo  2. Redemarrez votre ordinateur
    echo  3. Relancez ce fichier lancer.bat
    echo.
    pause
    exit /b 1
)

echo  [OK] Node.js detecte :
node --version

:: ── 2. Verifier/creer le fichier .env ────────────────────────
if not exist ".env" (
    echo.
    echo  [ATTENTION] Fichier .env introuvable.
    echo  Creation automatique depuis .env.example...
    copy ".env.example" ".env" >nul
    echo  [OK] Fichier .env cree.
    echo.
    echo  IMPORTANT : Verifiez que .env contient les bonnes valeurs
    echo  avant de continuer ^(UPSTASH_REDIS_REST_URL, TOKEN, comptes^).
    echo.
    start notepad ".env"
    pause
)

:: ── 3. Installer les dependances si besoin ────────────────────
if not exist "node_modules" (
    echo.
    echo  Installation des dependances npm...
    call npm install
    if %errorlevel% neq 0 (
        echo  [ERREUR] npm install a echoue.
        pause
        exit /b 1
    )
    echo  [OK] Dependances installees.
)

:: ── 4. Build du frontend ──────────────────────────────────────
echo.
echo  Construction du frontend...
call npm run build
if %errorlevel% neq 0 (
    echo  [ERREUR] Build Vite echoue. Verifiez les erreurs ci-dessus.
    pause
    exit /b 1
)
echo  [OK] Frontend construit.
echo.

:: ── 5. Ouvrir le navigateur en avance (retry automatique) ────
echo  Ouverture du navigateur...
start http://localhost:3000

:: ── 6. Lancer le serveur (au premier plan) ───────────────────
echo.
echo  ╔══════════════════════════════════════╗
echo  ║   Serveur en cours d'execution       ║
echo  ║   http://localhost:3000              ║
echo  ║                                      ║
echo  ║   NE FERMEZ PAS CETTE FENETRE        ║
echo  ║   Ctrl+C pour arreter le serveur     ║
echo  ╚══════════════════════════════════════╝
echo.

node server.js
