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


## Etape 2 : image de base node:24-slim

- `FROM node:latest` remplace par `FROM node:24-slim` : version fixee (24 = LTS) et variante slim (debian allegee)
- je garde debian pour l'instant parce que le Dockerfile fait encore un apt-get

taille des images de base (docker images) :

```
node:latest      1.8GB
node:24-slim     332MB
node:24-alpine   242MB
```

resultat :

| mesure | etape 1 | etape 2 |
|---|---|---|
| taille image | 1.89 GB | 922 MB |
| couche apt-get | 50.1 MB | 418 MB |
| build sans cache | 15.8 s | 61.5 s |
| rebuild apres modif de server.js | 15.0 s | 62.6 s |

L'image est divisee par 2 mais le build est 4 fois plus long. En fait node:latest contenait deja build-essential donc l'apt-get faisait presque rien, alors que sur slim il doit tout telecharger et installer (418 MB). Ca montre bien que cette ligne apt-get sert a rien pour notre appli -> etape suivante.


## Etape 3 : on enleve ce qui sert a rien

- suppression du `RUN apt-get ... build-essential ca-certificates locales` : aucune dependance native a compiler (express), et les locales sont pas utilisees
- suppression de `RUN npm run build` : le script build fait juste `echo "build step "`
- `EXPOSE 3000` seulement (server.js ecoute que sur PORT=3000)
- `NODE_ENV=production` au lieu de development (express active son cache et affiche moins de details dans les erreurs)

Dockerfile a cette etape :

```dockerfile
FROM node:24-slim
WORKDIR /app
COPY . /app
RUN npm install
EXPOSE 3000
ENV NODE_ENV=production
USER root
CMD ["node", "server.js"]
```

resultat :

| mesure | etape 2 | etape 3 |
|---|---|---|
| taille image | 922 MB | 362 MB |
| nb de couches | 18 | 16 |
| build sans cache | 61.5 s | 6.9 s |
| rebuild apres modif de server.js | 62.6 s | 5.2 s |

L'appli marche toujours pareil (http://localhost:3000 ok). Depuis le debut on est passe de 1.88 GB a 362 MB (-81 %).


## Etape 4 : ordre des couches (cache) + npm ci --omit=dev

- on copie d'abord seulement package.json et package-lock.json, on installe, et apres on copie server.js. Comme ca si je modifie juste le code, docker reutilise la couche des dependances
- `npm ci` au lieu de `npm install` : installe exactement les versions du package-lock (build reproductible)
- `--omit=dev` : nodemon est plus installe dans l'image
- `npm cache clean --force` dans le meme RUN pour pas garder le cache npm dans la couche
- on copie seulement server.js au lieu de `COPY . /app`

```dockerfile
FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.js ./
EXPOSE 3000
ENV NODE_ENV=production
USER root
CMD ["node", "server.js"]
```

resultat :

| mesure | etape 3 | etape 4 |
|---|---|---|
| taille image | 362 MB | 349 MB |
| couche des dependances | 25.6 MB | 16.6 MB |
| build sans cache | 6.9 s | 4.7 s |
| rebuild apres modif de server.js | 5.2 s | 1.3 s |

Le rebuild apres une modif du code passe de 5.2 s a 1.3 s, dans le log on voit `CACHED [3/4] RUN npm ci ...`. C'est surtout ca le gain de cette etape, au quotidien quand on developpe.


## Etape 5 : nettoyage des dependances et du code

- `npm uninstall mongodb` : le module etait installe mais jamais utilise dans server.js (et il ramene bson, whatwg-url, etc.)
- server.js :
    * le middleware qui fait un console.log a chaque requete est active seulement si NODE_ENV != production
    * route /big : `fs.createReadStream` au lieu de `existsSync` + `readFileSync`. Le fichier est lu par morceaux sans bloquer le serveur et sans tout charger en memoire
    * ajout d'une route /health (utilisee a l'etape du healthcheck)
    * gestion du signal SIGTERM : le serveur se ferme proprement quand on fait docker stop

test en local avant de builder :

```
PS> curl http://localhost:3000/big      -> Fichier introuvable
(avec un fichier maybe-big-file.txt "a\nb")
PS> curl http://localhost:3000/big      -> a<br/>b<br/>
PS> curl http://localhost:3000/health   -> 200
```

resultat :

| mesure | etape 4 | etape 5 |
|---|---|---|
| taille image | 349 MB | 338 MB |
| couche des dependances | 16.6 MB | 7.33 MB |
| build sans cache | 4.7 s | 3.4 s |
| docker stop | 3.7 s | 0.5 s |

Les dependances sont divisees par 2 en retirant mongodb. Et le docker stop est quasi instantane maintenant que le serveur gere SIGTERM.


## Etape 6 : passage a node:24-alpine

Maintenant qu'il y a plus d'apt-get dans le Dockerfile, on peut passer sur alpine (distribution linux minimale, utilise apk et musl au lieu de glibc). Pour express ca pose aucun probleme vu qu'il y a pas de module natif.

- `FROM node:24-slim` -> `FROM node:24-alpine`

resultat :

| mesure | etape 5 | etape 6 |
|---|---|---|
| taille image | 338 MB | 250 MB |
| build sans cache | 3.4 s | 4.2 s |
| rebuild apres modif de server.js | 1.2 s | 1.2 s |
| RAM | 21.1 MiB | 21.4 MiB |

-88 MB juste en changeant l'image de base. La RAM et le demarrage bougent pas, c'est normal c'est le meme node.


## Etape 7 : securite (utilisateur non root + healthcheck)

- `USER root` -> `USER node` : l'image node officielle a deja un utilisateur `node` sans droits admin. Si quelqu'un exploite une faille dans l'appli il est pas root dans le conteneur
- `COPY --chown=node:node` pour que le code appartienne a cet utilisateur
- `HEALTHCHECK` qui appelle /health avec wget (dispo dans alpine), docker sait si l'appli repond vraiment

```dockerfile
FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node server.js ./
ENV NODE_ENV=production
EXPOSE 3000
USER node
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD wget -qO- http://localhost:3000/health || exit 1
CMD ["node", "server.js"]
```

resultat :

```
PS> docker exec test whoami
node

PS> docker ps
STATUS
Up 8 seconds (healthy)
```

| mesure | etape 6 | etape 7 |
|---|---|---|
| taille image | 250 MB | 250 MB |
| utilisateur | root | node |
| healthcheck | non | oui (healthy) |

Pas de changement de taille ici, c'est une etape securite.
