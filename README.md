TP2 : Optimisation Docker

Recuperer le zip sur l'ENT (appli node.js express + Dockerfile pas optimise) et optimiser l'image etape par etape en mesurant la taille a chaque fois.

Pour mesurer j'ai utilise :
    * docker build --no-cache -t tp2:<etape> .
    * docker images tp2
    * docker history tp2:<etape>
    * docker run -d --name test -p 3000:3000 tp2:<etape>
    * docker stats test
    * docker exec test whoami



Etape 0 : baseline

- git init + .gitignore (node_modules) puis build du Dockerfile d'origine :
    * docker build --no-cache -t tp2:0-baseline .

    resultat :
    PS C:\Users\moham\Desktop\M2 MIAGE IPM\DEVops\TP2\tpdockeroptimisation> docker images tp2
REPOSITORY   TAG          SIZE
tp2          0-baseline   1.88GB

    PS> docker history tp2:0-baseline
0B        CMD ["node" "server.js"]
0B        USER root
36.9kB    RUN /bin/sh -c npm run build
0B        ENV NODE_ENV=development
0B        EXPOSE [3000/tcp 4000/tcp 5000/tcp]
50.1MB    RUN /bin/sh -c apt-get update && apt-get ins…
7.47MB    RUN /bin/sh -c npm install
307kB     COPY . /app
14.2MB    COPY node_modules ./node_modules
+ node:latest = 1.8GB

build sans cache : 21.2 s
rebuild apres avoir change une ligne dans server.js : 21.3 s (il refait tout)
RAM : 21.6 MiB
whoami -> root
docker stop : 3.6 s

les problemes que j'ai vu :
- node:latest trop gros (1.8GB) et la version change tout le temps
- COPY node_modules copie les modules de windows, et npm install est refait juste apres
- COPY . avant npm install donc le cache sert a rien
- npm install au lieu de npm ci, et nodemon (devDependencies) installe aussi
- apt-get build-essential et locales pas utiles
- EXPOSE 3000 4000 5000 alors que seul 3000 est utilise
- NODE_ENV=development
- npm run build fait juste un echo
- USER root
- pas de .dockerignore
- dans le code : mongodb jamais utilise, readFileSync bloquant dans /big, console.log a chaque requete, pas de gestion du SIGTERM



Etape 1 : .dockerignore

- ajout du .dockerignore (node_modules, .git, README...) et suppression de la ligne COPY node_modules. j'ai renommé dockerfile en Dockerfile aussi

    resultat :
tp2   1-dockerignore   1.89GB

build : 15.8 s (au lieu de 21.2)
PS : l'image a pris 6MB au lieu de baisser, parce que npm install installe tout maintenant et garde son cache (/root/.npm). la couche npm install passe de 7.47MB a 25.6MB. par contre le contexte envoyé est plus petit (65kB au lieu de 307kB + node_modules)



Etape 2 : image de base node:24-slim

- FROM node:latest -> FROM node:24-slim (version fixe)

taille des images de base :
node:latest      1.8GB
node:24-slim     332MB
node:24-alpine   242MB

    resultat :
tp2   2-slim   922MB

build : 61.5 s !! la couche apt-get passe de 50MB a 418MB parce que node:latest avait deja build-essential et slim non. donc ce apt-get sert vraiment a rien



Etape 3 : suppression de ce qui sert a rien

- enlever le RUN apt-get, le RUN npm run build
- EXPOSE 3000 seulement
- NODE_ENV=production

    resultat :
tp2   3-nettoyage   362MB

build : 6.9 s
rebuild apres modif server.js : 5.2 s



Etape 4 : cache des couches + npm ci

- copier package.json et package-lock.json d'abord, installer, puis copier server.js
- npm ci --omit=dev (plus de nodemon) + npm cache clean --force dans le meme RUN

FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.js ./
EXPOSE 3000
ENV NODE_ENV=production
USER root
CMD ["node", "server.js"]

    resultat :
tp2   4-cache   349MB

couche des dependances : 16.6MB (avant 25.6MB)
rebuild apres modif de server.js : 1.3 s (avant 5.2 s), on voit CACHED sur le npm ci



Etape 5 : code et dependances

- npm uninstall mongodb
- server.js : console.log seulement si pas en production, /big avec createReadStream au lieu de readFileSync, route /health, et process.on('SIGTERM') pour fermer le serveur proprement

test en local :
curl http://localhost:3000/big -> Fichier introuvable
curl http://localhost:3000/big (avec un fichier maybe-big-file.txt) -> a<br/>b<br/>
curl http://localhost:3000/health -> 200

    resultat :
tp2   5-code   338MB

couche des dependances : 7.33MB (avant 16.6MB)
docker stop : 0.5 s (avant 3.7 s)



Etape 6 : node:24-alpine

- plus d'apt-get donc on peut passer sur alpine : FROM node:24-alpine

    resultat :
tp2   6-alpine   250MB

build : 4.2 s, RAM pareil (21.4 MiB)



Etape 7 : utilisateur non root + healthcheck

- USER node (existe deja dans l'image node) + COPY --chown=node:node
- HEALTHCHECK avec wget sur /health

    resultat :
PS> docker exec test whoami
node
PS> docker ps
STATUS
Up 8 seconds (healthy)

taille pareil : 250MB



Etape 8 : multi-stage

- 1er stage node:24-alpine pour faire le npm ci
- 2eme stage alpine:3.24 + libstdc++ (besoin pour node, vu avec ldd /usr/local/bin/node), on copie juste le binaire node, node_modules et server.js. donc plus de npm/yarn dans l'image finale
- creation d'un user app

Dockerfile final :

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM alpine:3.24
RUN apk add --no-cache libstdc++ \
    && addgroup -S app && adduser -S app -G app
COPY --from=build /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --chown=app:app package.json server.js ./
ENV NODE_ENV=production
EXPOSE 3000
USER app
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD wget -qO- http://localhost:3000/health || exit 1
CMD ["node", "server.js"]

    resultat :
tp2   8-multistage   202MB

PS> docker exec hc sh -c "which npm || echo npm absent"
npm absent

le binaire node fait 131MB a lui seul donc difficile de descendre plus
build sans cache un peu plus long (10.6 s) mais rebuild 1.1 s



Recap :

PS> docker images tp2
REPOSITORY   TAG             SIZE
tp2          8-multistage    202MB
tp2          7-securite      250MB
tp2          6-alpine        250MB
tp2          5-code          338MB
tp2          4-cache         349MB
tp2          3-nettoyage     362MB
tp2          2-slim          922MB
tp2          1-dockerignore  1.89GB
tp2          0-baseline      1.88GB

test de charge avec autocannon (50 connexions, 10 s) :
    * npx autocannon -c 50 -d 10 http://localhost:3000/

baseline : 6295 req/s, latence 7.44 ms, RAM 41.6 MiB
final    : 8354 req/s, latence 5.49 ms, RAM 36.4 MiB

au final :
- 1.88GB -> 202MB (-89%)
- rebuild apres modif du code 21.3 s -> 1.1 s
- docker stop 3.6 s -> 0.6 s
- plus en root + healthcheck
- +33% de requetes/s (surtout grace au console.log enlevé et NODE_ENV=production)

ce qui a le plus fait baisser la taille c'est le changement d'image de base et enlever le apt-get.



à la fin je depose sur git a chaque etape :
 - git init
 - git remote add origin https://github.com/reda9627/TP-Optimisation-Docker-.git
 - git add .
 - git commit -m "etape X : ..."
 - git push origin main
