# Actualizaciones propias del escritorio (sin Microsoft Store)

Dos canales, independientes:

| Canal | Como se instala | Como se actualiza |
|---|---|---|
| Microsoft Store (MSIX) | Desde la Store | Solo por la Store (certificacion, hasta 3 dias) |
| Directo (Squirrel) | `starknetchat-desktop-setup.exe` de https://starknet-chat.tech/desktop-updates/ | Solo, en segundo plano, desde nuestro servidor |

La version de la Store desactiva el actualizador propio automaticamente
(`process.windowsStore` / no existe `Update.exe`).

IMPORTANTE: la interfaz (web) se carga desde starknet-chat.tech, asi que los
cambios web se despliegan al instante sin tocar el escritorio. Solo se necesita
una version nueva del escritorio cuando cambia la capa nativa
(`src/native`, preload, Electron).

## Publicar una version (PC Windows)

1. Subir `version` en `package.json`.
2. `npm.cmd install` y `npm.cmd run make`
   -> `out\make\squirrel.windows\x64\` contiene:
   `RELEASES`, `StarknetChat-X.Y.Z-full.nupkg`, `starknetchat-desktop-setup.exe`
3. Subir esa carpeta al VPS (ver `scripts/publish-update.ps1`).
4. Los clientes instalados la detectan en <= 4 h, la descargan y la
   instalan al reiniciar (o al pulsar la notificacion).

## Servidor

Carpeta estatica servida por HTTPS en
`https://starknet-chat.tech/desktop-updates/win32/x64/` (debe ser accesible el
fichero `RELEASES` y los `.nupkg`). Variable para pruebas:
`STARKNET_UPDATE_URL`.

## Seguridad / pendiente

- Squirrel comprueba el SHA1 de cada paquete contra `RELEASES`, pero no exige
  firma. Quien controle esa carpeta controla lo que se instala: protegerla.
- Sin firma de codigo, Windows SmartScreen avisa al ejecutar el instalador la
  primera vez ("Mas informacion > Ejecutar de todas formas").
