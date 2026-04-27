# Stage 1: Build the React client
FROM node:20-alpine AS client-build
WORKDIR /app
COPY client/package.json client/
RUN npm install --prefix client
COPY client/ client/
RUN npm run build --prefix client

# Stage 2: Production server
FROM node:20-alpine
WORKDIR /app
COPY server/package.json server/
RUN npm install --prefix server --omit=dev
COPY server/ server/
COPY --from=client-build /app/client/dist client/dist

# /data is mounted as a persistent Fly.io volume — DB and uploads live here
RUN mkdir -p /data/uploads

EXPOSE 3001
ENV NODE_ENV=production
ENV DB_PATH=/data/kitchen.db
ENV UPLOAD_DIR=/data/uploads/

CMD ["node", "server/index.js"]
