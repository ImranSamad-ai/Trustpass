FROM node:24-slim
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml tsconfig.json ./
RUN pnpm install --frozen-lockfile || pnpm install
COPY src ./src
RUN pnpm build && pnpm prune --prod
ENV PORT=8787 DATA_FILE=/data/passports.json NODE_ENV=production
VOLUME /data
EXPOSE 8787
HEALTHCHECK CMD node -e "fetch('http://localhost:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
