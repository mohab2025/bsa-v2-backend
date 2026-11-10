FROM node:22-bookworm-slim
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --chown=node:node backend/src ./src
COPY --chown=node:node lib/content /app/lib/content
COPY --chown=node:node lib/validation /app/lib/validation
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4000
USER node
EXPOSE 4000
CMD ["node", "--experimental-strip-types", "src/server.ts"]
