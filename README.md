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
