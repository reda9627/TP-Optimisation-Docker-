# TP-Optimisation-Docker

TP2 DevOps : optimiser petit a petit une appli Node.js (express) et son Dockerfile.
Pour chaque etape je note la taille de l'image, le temps de build et quelques mesures au lancement du conteneur.

Comment je mesure (a chaque etape) :
- taille : `docker images tp2`
- temps de build sans cache : `docker build --no-cache -t tp2:<etape> .` (l'image de base est deja telechargee donc le temps de pull ne compte pas)
- temps de rebuild apres avoir modifie juste une ligne de server.js (avec le cache)
- demarrage du conteneur, RAM (`docker stats`), utilisateur (`docker exec test whoami`), temps du `docker stop`


## Etape 0 : baseline (projet d'origine)

J'ai recupere le zip sur l'ENT, fait un git init et ajoute un .gitignore pour pas envoyer node_modules sur github.

Dockerfile de depart :

```dockerfile
FROM node:latest
WORKDIR /app
COPY node_modules ./node_modules
COPY . /app
RUN npm install
RUN apt-get update && apt-get install -y build-essential ca-certificates locales && echo "en_US.UTF-8 UTF-8" > /etc/locale.gen && locale-gen
EXPOSE 3000 4000 5000
ENV NODE_ENV=development
RUN npm run build
USER root
CMD ["node", "server.js"]
```

- build :
    * docker build --no-cache -t tp2:0-baseline .
- lancer :
    * docker run -d --name test -p 3000:3000 tp2:0-baseline
    * http://localhost:3000 -> "Hello world — serveur volontairement non optimisé mais fonctionnel"

resultat :

```
PS> docker images tp2
REPOSITORY   TAG          SIZE
tp2          0-baseline   1.88GB
```

`docker history tp2:0-baseline` (les couches qui pesent) :

```
50.1MB   RUN apt-get update && apt-get install -y build-essential ...
14.2MB   COPY node_modules ./node_modules
7.47MB   RUN npm install
307kB    COPY . /app
36.9kB   RUN npm run build
+ l'image node:latest elle meme : 1.8GB
```

| mesure | valeur |
|---|---|
| taille image | 1.88 GB |
| nb de couches | 20 |
| build sans cache | 21.2 s |
| rebuild apres modif de server.js | 21.3 s (tout est refait) |
| demarrage | 1.4 s |
| RAM | 21.6 MiB |
| utilisateur | root |
| docker stop | 3.6 s |

Ce que j'ai repere comme problemes :

Dans le Dockerfile
- `node:latest` : image enorme (1.8GB a elle seule) et la version change dans le temps donc pas reproductible
- `COPY node_modules` : on copie les modules installes sur Windows dans un conteneur Linux, en plus npm install est refait juste apres donc ca sert a rien
- `COPY . /app` avant le `npm install` : des qu'on touche au code tout le npm install est refait (on le voit : rebuild = meme temps que build complet)
- `npm install` au lieu de `npm ci` et ca installe aussi les devDependencies (nodemon)
- apt-get build-essential / locales : pas besoin, y a aucun module natif a compiler, et le cache apt est pas nettoye
- 3 ports exposes alors que l'appli ecoute que sur 3000
- `NODE_ENV=development` alors que c'est pour de la prod
- `npm run build` fait juste un echo
- `USER root`
- pas de .dockerignore

Dans le code
- `mongodb` est dans les dependances mais jamais utilise
- route /big : `existsSync` + `readFileSync` = bloquant, et tout le fichier est charge en memoire
- un console.log a chaque requete
- pas de gestion du SIGTERM


## Etape 1 : .dockerignore + suppression du COPY node_modules

- creation du fichier .dockerignore (node_modules, .git, README, Dockerfile...)
- suppression de la ligne `COPY node_modules ./node_modules` : les modules sont installes dans le conteneur par npm install, pas besoin de ceux de Windows
- j'ai aussi renomme `dockerfile` en `Dockerfile` (nom standard)

resultat :

```
PS> docker images tp2
REPOSITORY   TAG             SIZE
tp2          1-dockerignore  1.89GB
tp2          0-baseline      1.88GB
```

| mesure | etape 0 | etape 1 |
|---|---|---|
| taille image | 1.88 GB | 1.89 GB |
| couche COPY du code | 307 kB (+14.2 MB node_modules) | 65.5 kB |
| couche npm install | 7.47 MB | 25.6 MB |
| nb de couches | 20 | 19 |
| build sans cache | 21.2 s | 15.8 s |
| rebuild apres modif de server.js | 21.3 s | 15.0 s |

Remarque : l'image a pas diminue, elle a meme pris 6 MB. Avant, npm install trouvait deja les modules copies et faisait presque rien. Maintenant il installe tout et laisse son cache (/root/.npm) dans la couche. Par contre le contexte envoye a docker est beaucoup plus petit et le build est plus rapide (-5 s). Le gros du poids c'est l'image node:latest, c'est l'etape suivante.
