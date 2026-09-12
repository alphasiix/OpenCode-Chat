# OpenCode Claude — Interface desktop style Claude pour OpenCode

Fenêtre native Windows (.exe) avec design Claude moderne : historique à gauche, chat central, streaming, modèles.

## ✨ Fonctionnalités

- **Sidebar historique** comme Claude : groupé Aujourd'hui / Précédent, recherche, renommer, fork, supprimer
- **Chat central** : bulles user/assistant, markdown + code highlight, outils, reasoning, todo progress
- **Barre d'entrée** style Claude : textarea auto-grow, Shift+Entrée, suggestions, @ fichiers, / commandes
- **Sélecteur modèle** : charge tous les providers configurés (`/config/providers` + `/provider`)
- **Agents** : build / plan (Tab)
- **Connexion OpenCode Server** : détecte automatiquement `opencode serve` sur 4096-4115, ou le lance. SSE live (`/event`), fallback poll
- **Gestion sessions** : créer, ouvrir, supprimer, partager, fork, revert
- **Design Claude dark** : sidebar #171717, main #212121, accent #ff5a2b, arrondis, animations

## 🚀 Lancer en dev

```powershell
cd F:\OpenCodePlan
npm install
npm start          # lance Electron + détecte/lance opencode serve
npm run dev        # avec DevTools
```

Prérequis : `opencode` installé (`npm i -g opencode-ai` ou `choco install opencode`). Configure tes providers via `/connect` dans le TUI ou `opencode auth`.

Le serveur doit tourner :
```powershell
opencode serve --port 4096
# l'app le lance automatiquement si absent
```

## 📦 Générer le .exe (portable, sans installation)

```powershell
npm run build
```

Sortie dans `dist/` : `opencode-chat.exe` — double-clic, pas d'installation.

## 🔄 Mise à jour auto (1 seule release)

- Le repo a **une unique release** taggée `latest` qui contient le portable `.exe`.
- À chaque **push sur `main`**, le workflow `.github/workflows/release.yml` rebuild le `.exe` sur Windows et **remplace l'asset** de la release `latest`.
- L'app embarque sa date de build (`src/build-info.json`, généré par `npm run build`) et compare avec la date de l'asset distant au démarrage + toutes les 6h : si plus récent → popup **« Une nouvelle version est disponible »** avec bouton Télécharger.
- Vérification manuelle : ⚙ Paramètres → **Vérifier les mises à jour**.

## ⚙️ Config serveur

- Changer l'URL en haut à droite (ex: `http://127.0.0.1:4096`) puis OK, ou via ⚙ Paramètres
- État en bas de sidebar : ● Connecté / ● Reconnexion / ● Déconnecté
- Bouton ↻ pour redémarrer le serveur

## 🔌 API utilisée

`GET /global/health`, `GET /event` (SSE), `GET/POST /session`, `GET /session/:id/message`, `POST /session/:id/message` & `prompt_async`, `GET /config/providers`, `GET /agent`, `GET /project`, `GET /file`, etc. Spec : `http://localhost:4096/doc`

## 🎨 Personnaliser

- Couleurs dans `src/styles.css` (`:root`)
- Logo dans `src/index.html`
- Modèle par défaut sauvegardé dans `localStorage`

## 📝 Licence

MIT
