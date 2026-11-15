// proc-audio.exe — captura el audio de UN proceso (y sus hijos) en Windows
// mediante la API "process loopback" de WASAPI (Windows 10 2004+/11) y lo
// escribe por stdout como PCM s16le, 48000 Hz, estéreo. Así el audio
// compartido en una retransmisión es solo el de la ventana compartida
// (como en Discord), sin las voces de la llamada ni el resto del sistema.
//
// Uso:  proc-audio.exe --hwnd <HWND decimal>   |   proc-audio.exe --pid <PID>
//       proc-audio.exe --exclude-pid <PID>   (todo el audio del sistema MENOS
//       el de ese proceso y sus hijos: sirve para compartir pantalla completa
//       sin que se cuelen las voces de la propia app)
// Se detiene solo cuando se cierra stdin o stdout.
#define WIN32_LEAN_AND_MEAN
#ifndef _WIN32_WINNT
#define _WIN32_WINNT 0x0A00
#endif
#include <windows.h>
#include <initguid.h>
#include <mmdeviceapi.h>
#include <audioclient.h>

// Estructuras de audioclientactivationparams.h (no incluido en MinGW)
typedef enum {
  AUDIOCLIENT_ACTIVATION_TYPE_DEFAULT = 0,
  AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK = 1
} AUDIOCLIENT_ACTIVATION_TYPE;
typedef enum {
  PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE = 0,
  PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE = 1
} PROCESS_LOOPBACK_MODE;
typedef struct {
  DWORD TargetProcessId;
  PROCESS_LOOPBACK_MODE ProcessLoopbackMode;
} AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS;
typedef struct {
  AUDIOCLIENT_ACTIVATION_TYPE ActivationType;
  AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS ProcessLoopbackParams;
} AUDIOCLIENT_ACTIVATION_PARAMS;
#include <mmreg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <io.h>
#include <fcntl.h>

#ifndef VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK
#define VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK L"VAD\\Process_Loopback"
#endif

static const GUID kIID_IAgileObject = {0x94ea2b94, 0xe9cc, 0x49e0, {0xc0, 0xff, 0xee, 0x64, 0xca, 0x8f, 0x5b, 0x90}};

struct Handler : public IActivateAudioInterfaceCompletionHandler {
  LONG ref = 1;
  HANDLE done = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  HRESULT result = E_FAIL;
  IAudioClient *client = nullptr;

  STDMETHODIMP QueryInterface(REFIID riid, void **out) override {
    if (riid == IID_IUnknown || riid == __uuidof(IActivateAudioInterfaceCompletionHandler) ||
        memcmp(&riid, &kIID_IAgileObject, sizeof(GUID)) == 0) {
      *out = static_cast<IActivateAudioInterfaceCompletionHandler *>(this);
      AddRef();
      return S_OK;
    }
    *out = nullptr;
    return E_NOINTERFACE;
  }
  STDMETHODIMP_(ULONG) AddRef() override { return InterlockedIncrement(&ref); }
  STDMETHODIMP_(ULONG) Release() override { return InterlockedDecrement(&ref); }
  STDMETHODIMP ActivateCompleted(IActivateAudioInterfaceAsyncOperation *op) override {
    HRESULT act = E_FAIL;
    IUnknown *unk = nullptr;
    HRESULT hr = op->GetActivateResult(&act, &unk);
    if (SUCCEEDED(hr) && SUCCEEDED(act) && unk) {
      result = unk->QueryInterface(__uuidof(IAudioClient), (void **)&client);
      unk->Release();
    } else {
      result = FAILED(hr) ? hr : act;
    }
    SetEvent(done);
    return S_OK;
  }
};

static DWORD WINAPI watchStdin(LPVOID) {
  HANDLE in = GetStdHandle(STD_INPUT_HANDLE);
  char buf[64];
  DWORD n;
  while (ReadFile(in, buf, sizeof(buf), &n, nullptr) && n > 0) {}
  ExitProcess(0);
  return 0;
}

int main(int argc, char **argv) {
  DWORD pid = 0;
  bool exclude = false;
  for (int i = 1; i + 1 < argc; i++) {
    if (!strcmp(argv[i], "--hwnd")) {
      HWND hwnd = (HWND)(ULONG_PTR)_strtoui64(argv[i + 1], nullptr, 10);
      GetWindowThreadProcessId(hwnd, &pid);
    } else if (!strcmp(argv[i], "--pid")) {
      pid = (DWORD)strtoul(argv[i + 1], nullptr, 10);
    } else if (!strcmp(argv[i], "--exclude-pid")) {
      pid = (DWORD)strtoul(argv[i + 1], nullptr, 10);
      exclude = true;
    }
  }
  if (!pid) {
    fprintf(stderr, "proc-audio: sin proceso objetivo\n");
    return 2;
  }
  _setmode(_fileno(stdout), _O_BINARY);
  CreateThread(nullptr, 0, watchStdin, nullptr, 0, nullptr);

  HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  if (FAILED(hr)) { fprintf(stderr, "proc-audio: CoInitializeEx 0x%lx\n", hr); return 3; }

  AUDIOCLIENT_ACTIVATION_PARAMS ap = {};
  ap.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
  ap.ProcessLoopbackParams.TargetProcessId = pid;
  ap.ProcessLoopbackParams.ProcessLoopbackMode = exclude
      ? PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE
      : PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE;
  PROPVARIANT pv = {};
  pv.vt = VT_BLOB;
  pv.blob.cbSize = sizeof(ap);
  pv.blob.pBlobData = (BYTE *)&ap;

  Handler *handler = new Handler();
  IActivateAudioInterfaceAsyncOperation *op = nullptr;
  hr = ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, __uuidof(IAudioClient), &pv, handler, &op);
  if (FAILED(hr)) { fprintf(stderr, "proc-audio: ActivateAudioInterfaceAsync 0x%lx\n", hr); return 4; }
  WaitForSingleObject(handler->done, 10000);
  if (FAILED(handler->result) || !handler->client) {
    fprintf(stderr, "proc-audio: activacion fallida 0x%lx\n", handler->result);
    return 5;
  }
  IAudioClient *client = handler->client;

  WAVEFORMATEX fmt = {};
  fmt.wFormatTag = WAVE_FORMAT_PCM;
  fmt.nChannels = 2;
  fmt.nSamplesPerSec = 48000;
  fmt.wBitsPerSample = 16;
  fmt.nBlockAlign = fmt.nChannels * fmt.wBitsPerSample / 8;
  fmt.nAvgBytesPerSec = fmt.nSamplesPerSec * fmt.nBlockAlign;

  HANDLE ev = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  hr = client->Initialize(AUDCLNT_SHAREMODE_SHARED,
                          AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK |
                              AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
                          0, 0, &fmt, nullptr);
  if (FAILED(hr)) { fprintf(stderr, "proc-audio: Initialize 0x%lx\n", hr); return 6; }
  client->SetEventHandle(ev);

  IAudioCaptureClient *capture = nullptr;
  hr = client->GetService(__uuidof(IAudioCaptureClient), (void **)&capture);
  if (FAILED(hr)) { fprintf(stderr, "proc-audio: GetService 0x%lx\n", hr); return 7; }
  hr = client->Start();
  if (FAILED(hr)) { fprintf(stderr, "proc-audio: Start 0x%lx\n", hr); return 8; }
  fprintf(stderr, "proc-audio: capturando pid %lu\n", (unsigned long)pid);

  for (;;) {
    WaitForSingleObject(ev, 100);
    UINT32 packet = 0;
    while (SUCCEEDED(capture->GetNextPacketSize(&packet)) && packet > 0) {
      BYTE *data = nullptr;
      UINT32 frames = 0;
      DWORD flags = 0;
      if (FAILED(capture->GetBuffer(&data, &frames, &flags, nullptr, nullptr))) break;
      size_t bytes = (size_t)frames * fmt.nBlockAlign;
      bool ok = true;
      if (flags & AUDCLNT_BUFFERFLAGS_SILENT) {
        static char zeros[48000 * 4];
        size_t left = bytes;
        while (left && ok) {
          size_t n = left > sizeof(zeros) ? sizeof(zeros) : left;
          ok = fwrite(zeros, 1, n, stdout) == n;
          left -= n;
        }
      } else {
        ok = fwrite(data, 1, bytes, stdout) == bytes;
      }
      fflush(stdout);
      capture->ReleaseBuffer(frames);
      if (!ok) return 0;
    }
  }
}
