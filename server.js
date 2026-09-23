const express = require('express');
const fs = require('fs');
const path = require('path');


const app = express();


// logs des requetes seulement en dev (console.log a chaque requete ralentit en prod)
if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
  });
}


app.get('/', (req, res) => {
  res.send('Hello world — serveur volontairement non optimisé mais fonctionnel');
});


// route pour le healthcheck docker
app.get('/health', (req, res) => {
  res.sendStatus(200);
});


// lecture du fichier en stream : non bloquant et pas tout le fichier en memoire
app.get('/big', (req, res) => {
  const filePath = path.join(__dirname, 'maybe-big-file.txt');
  const stream = fs.createReadStream(filePath, 'utf8');

  stream.on('error', () => {
    res.send('Fichier introuvable');
  });

  stream.once('open', () => res.type('html'));
  stream.on('data', (chunk) => res.write(chunk.replace(/\n/g, '<br/>')));
  stream.on('end', () => res.end());
});


const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`Serveur démarré sur le port ${PORT}`);
});


// arret propre quand docker envoie SIGTERM (docker stop)
process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
