# StarknetChat Desktop

Desktop client for [StarknetChat](https://starknet-chat.tech), a self-hosted chat and voice platform for a private community. It is an Electron application that loads the StarknetChat web client and adds native features such as per-window audio capture for screen sharing, tray integration and automatic updates.

This project is a fork of the open-source Stoat for Desktop client and is licensed under the [GNU AGPL-3.0](LICENSE). The complete source code of this application is in this repository.

## Download

The Windows installer is available from [starknet-chat.tech](https://starknet-chat.tech) (login page and Settings > Apps) and directly at:

https://starknet-chat.tech/desktop-updates/win32/x64/starknetchat-desktop-setup.exe

The installed application updates itself in the background.

## Building from source

Requirements: Node.js 26, pnpm (the exact version is pinned in `package.json`) and, on Windows, the Microsoft C++ build tools for the two small native helpers in `native/`.

```
pnpm install
pnpm start      # run in development
pnpm make       # build the installer
```

The Windows installer is built by GitHub Actions from this repository (see `.github/workflows/build-windows.yml`).

## Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org).

Signed releases of the Windows installer are built from the source code in this repository by GitHub Actions, and every release is signed only after manual approval.

**Team roles**

- Committers and reviewers: [Edgar Vázquez (EDGAR431)](https://github.com/EDGAR431)
- Approvers: [Edgar Vázquez (EDGAR431)](https://github.com/EDGAR431)

## Privacy policy

This program does not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it. The application connects to the StarknetChat server at https://starknet-chat.tech, which is where the user signs in, and checks the same server for updates. It sends no analytics or telemetry to any other service.

Privacy policy of the StarknetChat service: https://starknet-chat.tech/privacy

## License

Copyright (C) 2025 Revolt Platforms LTD and contributors. Modifications Copyright (C) 2026 Edgar Vázquez. Distributed under the [GNU Affero General Public License v3.0](LICENSE).
