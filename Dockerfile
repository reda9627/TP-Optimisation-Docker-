FROM node:24-slim
WORKDIR /app
COPY . /app
RUN npm install
EXPOSE 3000
ENV NODE_ENV=production
USER root
CMD ["node", "server.js"]
