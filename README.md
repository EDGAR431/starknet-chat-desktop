# StarknetChat — Desktop App

Desktop application for Windows, macOS, and Linux, powering [starknet-chat.tech](https://starknet-chat.tech).

This repository is a modified fork of Stoat's desktop app (AGPL-3.0). It is published here to comply with that license. Related repositories:

- Web client: https://github.com/EDGAR431/starknet-chat-web
- Backend: https://github.com/EDGAR431/starknet-chat-backend
- Android app: https://github.com/EDGAR431/starknet-chat-android

## Development Guide

Before getting started, you'll want to install:

- [Git](https://git-scm.com/install/)
- [mise-en-place](https://mise.jdx.dev/getting-started.html)

Then proceed to setup:

```bash
# clone the repository
git clone https://github.com/EDGAR431/starknet-chat-desktop
cd starknet-chat-desktop

# Install tools from mise
mise install

# install all packages
mise install:frozen

# start the application
mise dev
# ... or build the bundle
mise build
# ... or build all distributables
mise make
```

Various useful commands for development testing:

```bash
# connect to the development server
mise exec -- pnpm start -- --force-server http://localhost:5173

# test the flatpak (after `make`)
mise exec -- pnpm install:flatpak
mise exec -- pnpm run:flatpak
# ... also connect to dev server like so:
mise exec -- pnpm run:flatpak --force-server http://localhost:5173

# Nix-specific instructions for testing
nix develop
pnpm package
pnpm run:nix
# ... as before:
pnpm run:nix --force-server=http://localhost:5173
```

### App assets

Forks are expected to provide their own branding assets; run `mise assets` after pulling if you need to regenerate them locally.

## License

AGPL-3.0 — see [LICENSE](./LICENSE).
