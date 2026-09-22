# ---- stage 1: build ----
# No --platform pin: Cloud Build runs on amd64 and produces amd64, so the build
# stage and the runtime stage match. (The old $BUILDPLATFORM trick only helped
# when cross-building on an Apple Silicon laptop for the amd64 VM.)
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- stage 2: serve ----
FROM nginx:1.31-alpine
COPY --from=build /app/dist /usr/share/nginx/html
# A *template*, not a finished config: the image's entrypoint renders it with the
# container's environment on every start, so the same image can point at a
# different API host per environment (see nginx.conf.template).
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
# Cloud Run sets PORT=8080 itself; the default keeps `docker run` on the VM identical.
ENV PORT=8080 \
    API_HOST=localhost
EXPOSE 8080
