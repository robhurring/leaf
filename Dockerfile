# A leaf relay (`leaf relay start`) as a container, for Heroku's container stack or anywhere else.

# 1. The UI: the leaf binary embeds the built page.
FROM node:22 AS ui
WORKDIR /src
COPY package.json package-lock.json ./
COPY packages/protocol/package.json packages/protocol/
COPY packages/ui/package.json packages/ui/
RUN npm ci
COPY packages packages
COPY tsconfig.base.json ./
RUN npm run build -w @leaf/protocol -w @leaf/ui

# 2. The binary. leaf-app links the Tauri window libraries even though the relay never opens one.
FROM rust:1-bookworm AS build
RUN apt-get update && apt-get install -y --no-install-recommends \
      libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev libssl-dev \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY crates crates
COPY --from=ui /src/packages/ui/dist packages/ui/dist
RUN cargo build --release -p leaf-app

# 3. Run it, with the shared libraries the binary loads at startup.
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates libwebkit2gtk-4.1-0 libgtk-3-0 librsvg2-2 libayatana-appindicator3-1 libssl3 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/target/release/leaf /usr/local/bin/leaf
CMD ["leaf", "relay", "start"]
