# Publicar una actualizacion en Microsoft Store

1. Subir la version: `package.json` -> `"version"` (ahora 1.7.0). Debe ser MAYOR que la publicada en la Store.
2. `npm.cmd install` y `npm.cmd run package` (genera `out\StarknetChat-win32-x64`).
3. Instalar el Windows SDK si no esta: `winget install Microsoft.WindowsSDK.10.0.26100`.
4. Datos de Partner Center (Gestion de productos > Identidad del producto):
   - Package/Identity/Name  (esperado: edgar36.StarkNetChat)
   - Package/Identity/Publisher (empieza por `CN=`)
   - Package/Properties/PublisherDisplayName
5. Construir el MSIX:
   `powershell -ExecutionPolicy Bypass -File store\build-msix.ps1 -Publisher "CN=..." -PublisherDisplayName "..."`
   Resultado: `out\StarkNetChat_1.7.0.0_x64.msix`
6. Partner Center > tu app > Actualizacion de envio > Paquetes: arrastrar el .msix, completar notas de version y enviar a certificacion.
