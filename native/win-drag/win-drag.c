// win-drag.exe — mueve la ventana de StarknetChat desde FUERA del proceso de
// la aplicacion, con la rapidez de un proceso nativo (cada 4 ms) y sin pasar
// por el hilo de JavaScript.
//
// Uso: win-drag.exe <ruta-del-log>   (queda en marcha y lee por stdin)
//   "drag <HWND decimal>"  -> arrastra la ventana mientras el boton izquierdo
//                              este pulsado (como una barra de titulo)
//
// Si la ventana esta maximizada la restaura (como Windows) y la coloca bajo
// el cursor. Windows a veces ignora restaurar con el boton pulsado: se
// reintenta de varias formas y, si no obedece, se hace al soltar.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static char g_log[MAX_PATH * 2];

static void logf_(const char *fmt, ...) {
  if (!g_log[0]) return;
  FILE *f = fopen(g_log, "ab");
  if (!f) return;
  SYSTEMTIME t;
  GetSystemTime(&t);
  fprintf(f, "%04d-%02d-%02dT%02d:%02d:%02d.%03dZ   [win-drag] ", t.wYear,
          t.wMonth, t.wDay, t.wHour, t.wMinute, t.wSecond, t.wMilliseconds);
  va_list ap;
  va_start(ap, fmt);
  vfprintf(f, fmt, ap);
  va_end(ap);
  fputc('\n', f);
  fclose(f);
}

static BOOL buttonDown(void) {
  return (GetAsyncKeyState(VK_LBUTTON) & 0x8000) != 0;
}

static void place(HWND hwnd, POINT c, double ratio) {
  RECT r;
  GetWindowRect(hwnd, &r);
  int w = r.right - r.left;
  MONITORINFO mi = {sizeof mi};
  GetMonitorInfo(MonitorFromPoint(c, MONITOR_DEFAULTTONEAREST), &mi);
  int x = (int)(c.x - ratio * w + 0.5);
  int y = c.y - 14;
  if (y < mi.rcWork.top) y = mi.rcWork.top;
  SetWindowPos(hwnd, NULL, x, y, 0, 0,
               SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
}

// Un intento de restaurar. Devuelve TRUE si la ventana ya no esta maximizada.
static BOOL tryRestore(HWND hwnd, DWORD winThread, int attempt) {
  DWORD me = GetCurrentThreadId();
  BOOL att = AttachThreadInput(me, winThread, TRUE);
  ReleaseCapture();
  if (attempt % 3 == 0) {
    ShowWindow(hwnd, SW_RESTORE);
  } else if (attempt % 3 == 1) {
    WINDOWPLACEMENT wp = {sizeof wp};
    GetWindowPlacement(hwnd, &wp);
    wp.showCmd = SW_SHOWNORMAL;
    SetWindowPlacement(hwnd, &wp);
  } else {
    PostMessageW(hwnd, WM_SYSCOMMAND, SC_RESTORE, 0);
  }
  if (att) AttachThreadInput(me, winThread, FALSE);
  Sleep(25);
  return !IsZoomed(hwnd);
}

static void doDrag(HWND hwnd) {
  if (!IsWindow(hwnd)) {
    logf_("HWND invalido");
    return;
  }
  POINT start;
  GetCursorPos(&start);
  DWORD winThread = GetWindowThreadProcessId(hwnd, NULL);
  BOOL zoomed = IsZoomed(hwnd);
  RECT r;
  GetWindowRect(hwnd, &r);
  logf_("drag: maximizada=%d cursor=%ld,%ld rect=%ld,%ld,%ld,%ld boton=%d",
        zoomed, start.x, start.y, r.left, r.top, r.right, r.bottom,
        buttonDown());
  if (!buttonDown()) return;

  double ratio = 0.5;
  int ww = r.right - r.left;
  if (ww > 0) {
    ratio = (double)(start.x - r.left) / ww;
    if (ratio < 0) ratio = 0;
    if (ratio > 1) ratio = 1;
  }

  DWORD t0 = GetTickCount();
  int attempt = 0;
  BOOL restored = !zoomed;
  POINT lastPos = start;
  POINT winOrigin = {r.left, r.top};

  while (buttonDown()) {
    POINT c;
    GetCursorPos(&c);

    if (!restored) {
      // umbral de 5 px antes de restaurar (un clic simple no mueve nada)
      if (abs(c.x - start.x) < 5 && abs(c.y - start.y) < 5) {
        Sleep(4);
        continue;
      }
      DWORD el = GetTickCount() - t0;
      if (el < 600) {
        restored = tryRestore(hwnd, winThread, attempt++);
        logf_("intento %d con el boton pulsado -> maximizada=%d (+%lums)",
              attempt, IsZoomed(hwnd), el);
        if (restored) {
          place(hwnd, c, ratio);
          GetWindowRect(hwnd, &r);
          winOrigin.x = r.left;
          winOrigin.y = r.top;
          start = c;
        } else {
          Sleep(30);
        }
        continue;
      }
      // no obedece con el boton pulsado: se espera a soltarlo
      Sleep(10);
      continue;
    }

    // ventana normal: seguir al cursor
    int x = winOrigin.x + (c.x - start.x);
    int y = winOrigin.y + (c.y - start.y);
    if (x != lastPos.x || y != lastPos.y) {
      lastPos.x = x;
      lastPos.y = y;
      SetWindowPos(hwnd, NULL, x, y, 0, 0,
                   SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE |
                       SWP_ASYNCWINDOWPOS);
    }
    Sleep(4);
  }

  if (!restored && IsZoomed(hwnd)) {
    // boton soltado: ahora Windows si deberia obedecer
    DWORD t1 = GetTickCount();
    while (GetTickCount() - t1 < 1500) {
      if (tryRestore(hwnd, winThread, attempt++)) {
        POINT c;
        GetCursorPos(&c);
        place(hwnd, c, ratio);
        logf_("restaurada tras soltar (+%lums, intento %d)",
              GetTickCount() - t1, attempt);
        return;
      }
      Sleep(20);
    }
    logf_("NO se pudo restaurar ni tras soltar");
  } else {
    logf_("fin del arrastre");
  }
}

int main(int argc, char **argv) {
  if (argc > 1) strncpy(g_log, argv[1], sizeof g_log - 1);

  // coordenadas reales en pantallas con escala distinta de 100 %
  typedef BOOL(WINAPI * SetCtx)(HANDLE);
  HMODULE u = GetModuleHandleW(L"user32.dll");
  SetCtx fn = u ? (SetCtx)GetProcAddress(u, "SetProcessDpiAwarenessContext") : 0;
  if (fn) fn((HANDLE)-4);  // PER_MONITOR_AWARE_V2

  logf_("en marcha");
  char line[128];
  while (fgets(line, sizeof line, stdin)) {
    if (strncmp(line, "drag ", 5) != 0) continue;
    doDrag((HWND)(ULONG_PTR)_strtoui64(line + 5, NULL, 10));
  }
  return 0;
}
