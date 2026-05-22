@echo off
title Glacerie — Alain Ducasse
color 0A

echo.
echo  ================================
echo   Glacerie ^| Alain Ducasse
echo  ================================
echo.

:: Aller dans le dossier du script (peu importe d'ou on le lance)
cd /d "%~dp0"

:: Verifier que Node.js est installe
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo  [ERREUR] Node.js n'est pas installe.
    echo  Telechargez-le sur : https://nodejs.org
    echo.
    pause
    exit /b 1
)

:: Verifier que le .env existe
if not exist ".env" (
    echo  [ATTENTION] Fichier .env introuvable.
    echo  Copie automatique depuis .env.example...
    copy ".env.example" ".env" >nul
    echo.
    echo  IMPORTANT : Ouvrez le fichier .env et ajoutez
    echo  votre cle ANTHROPIC_API_KEY avant de continuer.
    echo.
    start notepad ".env"
    pause
    exit /b 1
)

:: Mettre a jour depuis GitHub (si Git est installe)
where git >nul 2>nul
if %errorlevel% equ 0 (
    echo  Mise a jour depuis GitHub...
    git pull --quiet
    echo  OK
    echo.
)

:: Installer / mettre a jour les dependances si besoin
if not exist "node_modules" (
    echo  Installation des dependances...
    call npm install --silent
    echo  OK
    echo.
)

:: Build du frontend
echo  Construction du frontend...
call npm run build --silent
echo  OK
echo.

:: Ouvrir le navigateur en avance (il reessaiera automatiquement)
echo  Ouverture dans le navigateur...
start http://localhost:3000

echo.
echo  ================================
echo   Application en cours...
echo   Fermez cette fenetre pour
echo   arreter le serveur.
echo  ================================
echo.

:: Lancer le serveur (au premier plan — garde la fenetre ouverte)
node server.js
