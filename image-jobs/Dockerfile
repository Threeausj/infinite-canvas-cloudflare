FROM node:22-alpine
WORKDIR /app
COPY --chmod=644 server.mjs ./server.mjs
USER node
EXPOSE 8081
CMD ["node", "server.mjs"]
