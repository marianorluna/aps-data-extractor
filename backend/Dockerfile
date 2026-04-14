# Stage 1: Base
FROM node:18-alpine AS base
WORKDIR /app
RUN apk add --no-cache curl

# Stage 2: Dependencies
FROM base AS dependencies
COPY package*.json ./
RUN npm ci --only=production && \
    npm cache clean --force

# Stage 3: Build/Development
FROM base AS development
COPY package*.json ./
RUN npm ci && \
    npm cache clean --force
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev"]

# Stage 4: Production
FROM base AS production
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["npm", "start"]

# Default to development
FROM development
