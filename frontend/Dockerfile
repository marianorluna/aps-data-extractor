# Stage 1: Build
FROM node:18-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci && npm cache clean --force
COPY . .
RUN npm run build

# Stage 2: Runtime (Production target for Coolify)
FROM node:18-alpine AS production
WORKDIR /app
RUN npm install -g serve
COPY --from=build /app/build ./build
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
EXPOSE 3000
CMD ["serve", "-s", "build", "-l", "3000"]

# Development stage
FROM node:18-alpine AS development
WORKDIR /app
COPY package*.json ./
RUN npm ci && npm cache clean --force
COPY . .
EXPOSE 3000
CMD ["npm", "start"]

# Use development by default
FROM development
