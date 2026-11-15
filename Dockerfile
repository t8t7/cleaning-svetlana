FROM node:22.23.5-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22.23.5-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
RUN apk add --no-cache fontconfig font-dejavu
COPY package.json package-lock.json* ./
# Production deps only: Astro stays in devDependencies (build stage), so nested sharp@0.34 is not shipped.
RUN npm ci --omit=dev && mkdir -p data \
  && test ! -d node_modules/astro \
  && node -e "const s=require('sharp/package.json'); if(s.version!=='0.35.5'){console.error('unexpected sharp',s.version); process.exit(1)}"
COPY --from=build /app/dist ./dist
COPY server ./server
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
