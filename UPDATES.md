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
2. `npm.cmd install` (solo la primera vez o si cambian dependencias).
3. `npm.cmd run release`

Eso compila, sube a `/root/stoat/desktop-updates/win32/x64/` (primero el paquete
y el instalador, `RELEASES` el ultimo) y comprueba desde la URL publica que
`RELEASES` y el instalador coinciden con los locales. Si algo falla, se detiene
con un mensaje. `-SkipBuild` sube lo que ya esta compilado:
`npm.cmd run release -- -SkipBuild`.

Para que no pida la contrasena 3 veces, configurar una clave SSH (una sola vez):

```powershell
ssh-keygen -t ed25519
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh root@45.133.178.187 "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"
```

Los clientes instalados la detectan en <= 4 h, la descargan y la instalan al
reiniciar (o al pulsar la notificacion).

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

## Aviso para la version de la Store

La version de la Store consulta cada 6 h
`https://starknet-chat.tech/desktop-updates/store-latest.json`:

```json
{ "version": "1.7.0" }
```

Si esa version es mayor que la instalada, muestra una notificacion con acceso
a la ficha de la Store. **Publicar ese fichero solo cuando la Store ya haya
publicado la version** (en el VPS: `~/stoat/desktop-updates/store-latest.json`).
