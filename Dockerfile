FROM node:22-alpine
WORKDIR /app
COPY package.json server.js README.md ./
COPY src ./src
COPY web ./web
COPY eval ./eval
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
