// win-drag.exe — ayudante para arrastrar la ventana por la barra de titulo
// personalizada con el comportamiento NATIVO de Windows (como un arrastre de
// barra de titulo real): restaura al instante una ventana maximizada y la
// coloca bajo el cursor, ajuste a bordes (Aero Snap), varios monitores...
//
// Uso: se deja en marcha y lee por stdin lineas "move <HWND decimal>".
// Al recibir una, libera la captura del raton de la ventana (la tiene
// Chromium mientras el boton esta pulsado) y le envia WM_NCLBUTTONDOWN con
// HTCAPTION: Windows inicia entonces su bucle de movimiento de ventana, que
// dura hasta que se suelta el boton. Se cierra solo al cerrarse stdin.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void) {
  char line[128];
  while (fgets(line, sizeof line, stdin)) {
    if (strncmp(line, "move ", 5) != 0) continue;
    HWND hwnd = (HWND)(ULONG_PTR)_strtoui64(line + 5, NULL, 10);
    if (!IsWindow(hwnd)) continue;

    POINT p;
    GetCursorPos(&p);

    // La captura pertenece al hilo de la interfaz de la ventana: se enlaza la
    // cola de entrada de este proceso a la suya para poder liberarla.
    DWORD winThread = GetWindowThreadProcessId(hwnd, NULL);
    DWORD me = GetCurrentThreadId();
    BOOL attached = AttachThreadInput(me, winThread, TRUE);
    ReleaseCapture();
    PostMessageW(hwnd, WM_NCLBUTTONDOWN, HTCAPTION,
                 MAKELPARAM((short)p.x, (short)p.y));
    if (attached) AttachThreadInput(me, winThread, FALSE);
  }
  return 0;
}
