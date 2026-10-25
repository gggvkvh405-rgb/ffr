/*
 * ByAzen — native Windows shell.
 *
 * The UI ships inside the executable as RCDATA resources: a single-file build of
 * the React app plus its favicon. At start-up the shell binds a small HTTP server
 * to 127.0.0.1 and serves that bundle, so the page gets a real origin and
 * localStorage, sessionStorage and fetch() behave exactly like they do on the
 * web. The window is a Microsoft Edge WebView2 control.
 *
 * Links that leave the app are routed by the UI to GET /open?url=..., and this
 * server hands them to the system default browser.
 *
 * Build: scripts/build-windows.sh (zig cc -target x86_64-windows-gnu)
 */

#define WIN32_LEAN_AND_MEAN
#define _CRT_SECURE_NO_WARNINGS
#define UNICODE
#define _UNICODE

#include "http.h"

#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <shellapi.h>
#include <shlobj.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>

/* ------------------------------------------------------------------------- */
/* Constants                                                                 */
/* ------------------------------------------------------------------------- */

#define BYAZEN_TITLE L"ByAzen"
#define BYAZEN_CLASS L"ByAzenMainWindow"
#define BYAZEN_MUTEX L"Local\\ByAzen.SingleInstance"
#define RES_HTML 101
#define RES_FAVICON 102
#define RES_LOADER 103
#define BYAZEN_WATCHDOG 1
#define BASE_PORT 47821
#define PORT_ATTEMPTS 12

/* ------------------------------------------------------------------------- */
/* Globals                                                                   */
/* ------------------------------------------------------------------------- */

static HINSTANCE g_instance;
static HWND g_hwnd;
static HBRUSH g_bg_brush;
static int g_port;

static void *g_env;        /* ICoreWebView2Environment*   */
static void *g_controller; /* ICoreWebView2Controller*    */
static void *g_webview;    /* ICoreWebView2*              */

/* ------------------------------------------------------------------------- */
/* Minimal WebView2 ABI                                                      */
/*                                                                            */
/* The WebView2 SDK headers are not available offline, so only the handful of */
/* interfaces used here are declared. Slot order follows WebView2.h 1.0.     */
/* ------------------------------------------------------------------------- */

typedef struct ICoreWebView2Environment ICoreWebView2Environment;
typedef struct ICoreWebView2Controller ICoreWebView2Controller;
typedef struct ICoreWebView2 ICoreWebView2;

typedef HRESULT(STDMETHODCALLTYPE *PFN_CreateEnvWithOptions)(PCWSTR browser_executable_folder,
                                                             PCWSTR user_data_folder,
                                                             void *environment_options,
                                                             void *environment_created_handler);

/* ICoreWebView2Environment */
typedef struct EnvironmentVtbl {
  HRESULT(STDMETHODCALLTYPE *QueryInterface)(ICoreWebView2Environment *, const GUID *, void **);
  ULONG(STDMETHODCALLTYPE *AddRef)(ICoreWebView2Environment *);
  ULONG(STDMETHODCALLTYPE *Release)(ICoreWebView2Environment *);
  HRESULT(STDMETHODCALLTYPE *CreateCoreWebView2Controller)(ICoreWebView2Environment *, HWND, void *);
  void *after_controller;
  void *after_controller_2;
  void *after_controller_3;
  void *after_controller_4;
} EnvironmentVtbl;

struct ICoreWebView2Environment {
  EnvironmentVtbl *lpVtbl;
};

/* ICoreWebView2Controller — 23 methods after IUnknown. */
typedef struct ControllerVtbl {
  HRESULT(STDMETHODCALLTYPE *QueryInterface)(ICoreWebView2Controller *, const GUID *, void **);
  ULONG(STDMETHODCALLTYPE *AddRef)(ICoreWebView2Controller *);
  ULONG(STDMETHODCALLTYPE *Release)(ICoreWebView2Controller *);
  HRESULT(STDMETHODCALLTYPE *get_IsVisible)(ICoreWebView2Controller *, BOOL *);
  HRESULT(STDMETHODCALLTYPE *put_IsVisible)(ICoreWebView2Controller *, BOOL);
  HRESULT(STDMETHODCALLTYPE *get_Bounds)(ICoreWebView2Controller *, RECT *);
  HRESULT(STDMETHODCALLTYPE *put_Bounds)(ICoreWebView2Controller *, RECT);
  void *get_ZoomFactor;
  void *put_ZoomFactor;
  void *add_ZoomFactorChanged;
  void *remove_ZoomFactorChanged;
  void *SetBoundsAndZoomFactor;
  HRESULT(STDMETHODCALLTYPE *MoveFocus)(ICoreWebView2Controller *, int);
  void *after_move_focus[11];
  HRESULT(STDMETHODCALLTYPE *Close)(ICoreWebView2Controller *);
  HRESULT(STDMETHODCALLTYPE *get_CoreWebView2)(ICoreWebView2Controller *, ICoreWebView2 **);
} ControllerVtbl;

struct ICoreWebView2Controller {
  ControllerVtbl *lpVtbl;
};

/* ICoreWebView2 — only Navigate is called, but the slots before it must match. */
typedef struct WebViewVtbl {
  HRESULT(STDMETHODCALLTYPE *QueryInterface)(ICoreWebView2 *, const GUID *, void **);
  ULONG(STDMETHODCALLTYPE *AddRef)(ICoreWebView2 *);
  ULONG(STDMETHODCALLTYPE *Release)(ICoreWebView2 *);
  void *get_Settings;
  void *get_Source;
  HRESULT(STDMETHODCALLTYPE *Navigate)(ICoreWebView2 *, LPCWSTR);
  void *after_navigate[43];
} WebViewVtbl;

struct ICoreWebView2 {
  WebViewVtbl *lpVtbl;
};

/* Completion handlers: the runtime only calls QueryInterface / AddRef /
 * Release / Invoke, and the object layout is ours, so no SDK header is needed. */

typedef struct HandlerVtbl {
  HRESULT(STDMETHODCALLTYPE *QueryInterface)(void *, const GUID *, void **);
  ULONG(STDMETHODCALLTYPE *AddRef)(void *);
  ULONG(STDMETHODCALLTYPE *Release)(void *);
  HRESULT(STDMETHODCALLTYPE *Invoke)(void *, HRESULT, void *);
} HandlerVtbl;

typedef struct Handler {
  HandlerVtbl *lpVtbl;
  LONG ref;
  int kind; /* 0 = environment, 1 = controller */
} Handler;

static Handler g_env_handler;
static Handler g_ctrl_handler;

static HRESULT STDMETHODCALLTYPE env_invoke(Handler *self, HRESULT result,
                                            ICoreWebView2Environment *env);
static HRESULT STDMETHODCALLTYPE ctrl_invoke(Handler *self, HRESULT result,
                                             ICoreWebView2Controller *controller);

static void show_error(const WCHAR *text);

/* ------------------------------------------------------------------------- */
/* Resources                                                                 */
/* ------------------------------------------------------------------------- */

static const void *res_data(int id, DWORD *out_size) {
  HRSRC info = FindResourceW(g_instance, MAKEINTRESOURCEW(id), RT_RCDATA);
  if (!info) return NULL;
  HGLOBAL handle = LoadResource(g_instance, info);
  if (!handle) return NULL;
  void *data = LockResource(handle);
  DWORD size = SizeofResource(g_instance, info);
  if (!data || size == 0) return NULL;
  if (out_size) *out_size = size;
  return data;
}

/* ------------------------------------------------------------------------- */
/* Platform hooks for native/http.c                                          */
/* ------------------------------------------------------------------------- */

const void *byazen_resource(int id, unsigned long *size) {
  DWORD bytes = 0;
  const void *data = res_data(id, &bytes);
  if (data && size) *size = (unsigned long)bytes;
  return data;
}

int byazen_conn_send(uintptr_t conn, const void *data, int len) {
  int sent = send((SOCKET)conn, (const char *)data, len, 0);
  return sent;
}

int byazen_conn_recv(uintptr_t conn, void *buffer, int len) {
  return recv((SOCKET)conn, (char *)buffer, len, 0);
}

void byazen_conn_close(uintptr_t conn) {
  SOCKET socket = (SOCKET)conn;
  shutdown(socket, SD_SEND);
  closesocket(socket);
}

int byazen_open_external(const char *url) {
  WCHAR wide[3072];
  if (!byazen_is_http_url(url)) return 0;
  if (MultiByteToWideChar(CP_UTF8, 0, url, -1, wide, 3072) <= 0) return 0;
  HINSTANCE opened = ShellExecuteW(NULL, L"open", wide, NULL, NULL, SW_SHOWNORMAL);
  return (INT_PTR)opened > 32;
}

static DWORD WINAPI client_thread(LPVOID param) {
  byazen_http_serve((uintptr_t)param);
  return 0;
}

static DWORD WINAPI server_thread(LPVOID param) {
  SOCKET listener = (SOCKET)(uintptr_t)param;
  for (;;) {
    SOCKET client = accept(listener, NULL, NULL);
    if (client == INVALID_SOCKET) break;

    /* A stalled speculative connection must not block the whole server. */
    DWORD timeout_ms = 4000;
    setsockopt(client, SOL_SOCKET, SO_RCVTIMEO, (const char *)&timeout_ms, sizeof(timeout_ms));
    setsockopt(client, SOL_SOCKET, SO_SNDTIMEO, (const char *)&timeout_ms, sizeof(timeout_ms));

    HANDLE thread = CreateThread(NULL, 0, client_thread, (LPVOID)(uintptr_t)client, 0, NULL);
    if (thread) {
      CloseHandle(thread);
    } else {
      closesocket(client);
    }
  }
  return 0;
}

static int start_server(void) {
  WSADATA wsa;
  if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) return -1;

  struct sockaddr_in addr;
  memset(&addr, 0, sizeof(addr));
  addr.sin_family = AF_INET;
  addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);

  SOCKET listener = INVALID_SOCKET;
  BOOL bound = FALSE;
  for (int attempt = 0; attempt < PORT_ATTEMPTS && !bound; attempt++) {
    listener = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (listener == INVALID_SOCKET) continue;

    /* Refuse to share the port with another process. */
    BOOL exclusive = TRUE;
    setsockopt(listener, SOL_SOCKET, SO_EXCLUSIVEADDRUSE, (const char *)&exclusive,
               sizeof(exclusive));

    /* The last attempt asks the OS for any free port. */
    int candidate = attempt == PORT_ATTEMPTS - 1 ? 0 : BASE_PORT + attempt;
    addr.sin_port = htons((u_short)candidate);

    if (bind(listener, (struct sockaddr *)&addr, sizeof(addr)) == 0) {
      bound = TRUE;
    } else {
      closesocket(listener);
      listener = INVALID_SOCKET;
    }
  }
  if (!bound || listener == INVALID_SOCKET || listen(listener, 16) != 0) {
    if (listener != INVALID_SOCKET) closesocket(listener);
    WSACleanup();
    return -1;
  }

  int addr_len = (int)sizeof(addr);
  if (getsockname(listener, (struct sockaddr *)&addr, &addr_len) != 0) {
    closesocket(listener);
    WSACleanup();
    return -1;
  }

  HANDLE thread = CreateThread(NULL, 0, server_thread, (LPVOID)(uintptr_t)listener, 0, NULL);
  if (!thread) {
    closesocket(listener);
    WSACleanup();
    return -1;
  }
  CloseHandle(thread);
  return (int)ntohs(addr.sin_port);
}

/* ------------------------------------------------------------------------- */
/* WebView2 discovery                                                        */
/* ------------------------------------------------------------------------- */

static BOOL file_exists(const WCHAR *path) {
  DWORD attr = GetFileAttributesW(path);
  return attr != INVALID_FILE_ATTRIBUTES && !(attr & FILE_ATTRIBUTE_DIRECTORY);
}

static void join_path(WCHAR *out, size_t count, const WCHAR *dir, const WCHAR *name) {
  _snwprintf(out, count - 1, L"%s\\%s", dir, name);
  out[count - 1] = L'\0';
}

static BOOL try_dll(const WCHAR *dir, const WCHAR *name, PFN_CreateEnvWithOptions *out) {
  WCHAR path[MAX_PATH * 2];
  join_path(path, MAX_PATH * 2, dir, name);
  if (!file_exists(path)) return FALSE;

  /* Runtime DLLs resolve sibling files (and the VC runtime) by name. */
  SetDllDirectoryW(dir);
  HMODULE module = LoadLibraryW(path);
  if (!module) return FALSE;

  FARPROC proc = GetProcAddress(module, "CreateCoreWebView2EnvironmentWithOptions");
  if (!proc) {
    FreeLibrary(module);
    return FALSE;
  }
  *out = (PFN_CreateEnvWithOptions)proc;
  return TRUE;
}

static void reset_dll_directory(void) { SetDllDirectoryW(NULL); }

/* Compares dotted version directory names; returns > 0 when a is newer. */
static int compare_versions(const WCHAR *a, const WCHAR *b) {
  int i = 0;
  int j = 0;
  while (a[i] || b[j]) {
    long va = 0;
    long vb = 0;
    while (a[i] >= L'0' && a[i] <= L'9') va = va * 10 + (a[i++] - L'0');
    while (b[j] >= L'0' && b[j] <= L'9') vb = vb * 10 + (b[j++] - L'0');
    if (va != vb) return va > vb ? 1 : -1;
    while (a[i] && (a[i] < L'0' || a[i] > L'9')) i++;
    while (b[j] && (b[j] < L'0' || b[j] > L'9')) j++;
  }
  return 0;
}

/* Extracts the redistributable WebView2Loader.dll next to our per-user data.
 * Used only when the runtime folder does not expose a usable loader itself. */
static BOOL extract_loader(WCHAR *dir_out, size_t count) {
  DWORD size = 0;
  const void *data = res_data(RES_LOADER, &size);
  if (!data || size == 0) return FALSE;

  WCHAR base[MAX_PATH * 2];
  if (GetEnvironmentVariableW(L"LOCALAPPDATA", base, MAX_PATH * 2) == 0) return FALSE;

  WCHAR dir[MAX_PATH * 2];
  join_path(dir, MAX_PATH * 2, base, L"ByAzen");
  SHCreateDirectoryExW(NULL, dir, NULL);

  WCHAR path[MAX_PATH * 2];
  join_path(path, MAX_PATH * 2, dir, L"WebView2Loader.dll");

  WIN32_FILE_ATTRIBUTE_DATA info;
  BOOL cached = GetFileAttributesExW(path, GetFileExInfoStandard, &info) &&
                info.nFileSizeHigh == 0 && info.nFileSizeLow == size;
  if (!cached) {
    HANDLE file = CreateFileW(path, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS,
                              FILE_ATTRIBUTE_NORMAL, NULL);
    if (file == INVALID_HANDLE_VALUE) return FALSE;
    DWORD written = 0;
    BOOL ok = WriteFile(file, data, size, &written, NULL) && written == size;
    CloseHandle(file);
    if (!ok) return FALSE;
  }

  if (dir_out && count) {
    wcsncpy(dir_out, dir, count - 1);
    dir_out[count - 1] = L'\0';
  }
  return TRUE;
}

static BOOL find_application_version(const WCHAR *application_root,
                                     PFN_CreateEnvWithOptions *out) {
  WCHAR pattern[MAX_PATH * 2];
  WIN32_FIND_DATAW data;
  WCHAR best[MAX_PATH] = {0};

  join_path(pattern, MAX_PATH * 2, application_root, L"*");
  HANDLE find = FindFirstFileW(pattern, &data);
  if (find == INVALID_HANDLE_VALUE) return FALSE;

  do {
    if (!(data.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY)) continue;
    if (data.cFileName[0] == L'.') continue;
    if (best[0] == 0 || compare_versions(data.cFileName, best) > 0) {
      wcsncpy(best, data.cFileName, MAX_PATH - 1);
      best[MAX_PATH - 1] = L'\0';
    }
  } while (FindNextFileW(find, &data));
  FindClose(find);

  if (best[0] == 0) return FALSE;

  WCHAR version_dir[MAX_PATH * 2];
  join_path(version_dir, MAX_PATH * 2, application_root, best);

  if (try_dll(version_dir, L"WebView2Loader.dll", out)) return TRUE;
  if (try_dll(version_dir, L"EmbeddedBrowserWebView.dll", out)) return TRUE;
  return FALSE;
}

static BOOL try_under_base(const WCHAR *base, PFN_CreateEnvWithOptions *out) {
  WCHAR root[MAX_PATH * 2];
  join_path(root, MAX_PATH * 2, base, L"Microsoft\\EdgeWebView\\Application");
  return find_application_version(root, out);
}

static BOOL resolve_webview2(PFN_CreateEnvWithOptions *out) {
  WCHAR exe_dir[MAX_PATH * 2];
  DWORD len = GetModuleFileNameW(NULL, exe_dir, MAX_PATH * 2);

  if (len > 0 && len < MAX_PATH * 2) {
    WCHAR *slash = wcsrchr(exe_dir, L'\\');
    if (slash) *slash = L'\0';
    if (try_dll(exe_dir, L"WebView2Loader.dll", out)) return TRUE;
    if (try_dll(exe_dir, L"EmbeddedBrowserWebView.dll", out)) return TRUE;
  }

  static const WCHAR *env_names[] = {L"LOCALAPPDATA", L"ProgramFiles(x86)", L"ProgramFiles",
                                     L"ProgramW6432"};
  for (int i = 0; i < 4; i++) {
    WCHAR base[MAX_PATH * 2];
    DWORD got = GetEnvironmentVariableW(env_names[i], base, MAX_PATH * 2);
    if (got == 0 || got >= MAX_PATH * 2) continue;
    if (try_under_base(base, out)) return TRUE;
  }

  /* Last resort: unpack the loader that ships inside this executable. */
  WCHAR loader_dir[MAX_PATH * 2];
  if (extract_loader(loader_dir, MAX_PATH * 2) &&
      try_dll(loader_dir, L"WebView2Loader.dll", out))
    return TRUE;

  return FALSE;
}

/* ------------------------------------------------------------------------- */
/* Handlers                                                                  */
/* ------------------------------------------------------------------------- */

static ULONG STDMETHODCALLTYPE handler_add_ref(void *self) {
  return (ULONG)InterlockedIncrement(&((Handler *)self)->ref);
}

static ULONG STDMETHODCALLTYPE handler_release(void *self) {
  return (ULONG)InterlockedDecrement(&((Handler *)self)->ref);
}

static HRESULT STDMETHODCALLTYPE handler_query_interface(void *self, const GUID *riid, void **ppv) {
  static const GUID iid_unknown = {0x00000000, 0x0000, 0x0000, {0xC0, 0x00, 0, 0, 0, 0, 0, 0x46}};
  static const GUID iid_env_handler = {0x4e8a3389, 0xc9d8, 0x4bd2,
                                       {0xb6, 0xb5, 0x12, 0x4f, 0xee, 0x6c, 0xc1, 0x4d}};
  static const GUID iid_ctrl_handler = {0x6c4819f3, 0xc9b7, 0x4260,
                                        {0x81, 0x27, 0xc9, 0xf5, 0xbd, 0xe7, 0xf6, 0x8c}};
  Handler *self_handler = (Handler *)self;

  if (!ppv) return E_POINTER;
  *ppv = NULL;
  if (!riid) return E_INVALIDARG;

  if (IsEqualGUID(riid, &iid_unknown) ||
      (self_handler->kind == 0 && IsEqualGUID(riid, &iid_env_handler)) ||
      (self_handler->kind == 1 && IsEqualGUID(riid, &iid_ctrl_handler))) {
    *ppv = self;
    handler_add_ref(self);
    return S_OK;
  }
  return E_NOINTERFACE;
}

static HandlerVtbl g_env_vtbl = {handler_query_interface, handler_add_ref, handler_release,
                                 (HRESULT(STDMETHODCALLTYPE *)(void *, HRESULT, void *))env_invoke};
static HandlerVtbl g_ctrl_vtbl = {handler_query_interface, handler_add_ref, handler_release,
                                  (HRESULT(STDMETHODCALLTYPE *)(void *, HRESULT, void *))ctrl_invoke};

/* ------------------------------------------------------------------------- */
/* WebView2 start-up                                                         */
/* ------------------------------------------------------------------------- */

static void resize_webview(void) {
  if (!g_controller) return;
  RECT rc;
  GetClientRect(g_hwnd, &rc);
  ICoreWebView2Controller *controller = (ICoreWebView2Controller *)g_controller;
  if (controller->lpVtbl && controller->lpVtbl->put_Bounds)
    controller->lpVtbl->put_Bounds(controller, rc);
}

static void focus_webview(void) {
  if (!g_controller) return;
  ICoreWebView2Controller *controller = (ICoreWebView2Controller *)g_controller;
  if (controller->lpVtbl && controller->lpVtbl->MoveFocus)
    controller->lpVtbl->MoveFocus(controller, 0); /* PROGRAMMATIC */
}

/* ICoreWebView2Controller2::put_DefaultBackgroundColor — avoids the white flash
 * while the WebView starts up. COREWEBVIEW2_COLOR is { BYTE A; BYTE R; BYTE G;
 * BYTE B; }, a 4-byte struct that travels in a register, so it is packed here in
 * the same memory order the struct would have. */
static void set_webview_background(ICoreWebView2Controller *controller, unsigned int argb) {
  static const GUID iid_controller2 = {0xc979903e, 0xd4ca, 0x4228,
                                       {0x92, 0xeb, 0x47, 0xee, 0x3f, 0xa9, 0x6e, 0xab}};
  void *controller2 = NULL;
  if (FAILED(controller->lpVtbl->QueryInterface(controller, &iid_controller2, &controller2)) ||
      !controller2)
    return;

  void **vtbl = *(void ***)controller2;
  typedef HRESULT(STDMETHODCALLTYPE * PutDefaultBackgroundColor)(void *, unsigned int);
  PutDefaultBackgroundColor put = (PutDefaultBackgroundColor)vtbl[27];
  if (put) put(controller2, argb);
  ((ULONG(STDMETHODCALLTYPE *)(void *))vtbl[2])(controller2);
}

static void navigate_home(void) {
  if (!g_webview) return;
  ICoreWebView2 *webview = (ICoreWebView2 *)g_webview;
  WCHAR url[128];
  _snwprintf(url, 127, L"http://127.0.0.1:%d/?desktop=1", g_port);
  url[127] = L'\0';
  webview->lpVtbl->Navigate(webview, url);
}

static HRESULT STDMETHODCALLTYPE ctrl_invoke(Handler *self, HRESULT result,
                                             ICoreWebView2Controller *controller) {
  (void)self;
  if (FAILED(result) || !controller) {
    show_error(L"Не удалось создать окно браузера.\n\n"
               L"Обновите Microsoft Edge WebView2 Runtime и запустите ByAzen снова.");
    PostQuitMessage(1);
    return S_OK;
  }

  g_controller = controller;
  /* The loader has done its job; drop the extra DLL search directory. */
  reset_dll_directory();
  if (g_hwnd) KillTimer(g_hwnd, BYAZEN_WATCHDOG);
  /* #07080a, the app's canvas colour. */
  set_webview_background(controller, 0x0A0807FFu);
  if (controller->lpVtbl->put_IsVisible) controller->lpVtbl->put_IsVisible(controller, TRUE);
  resize_webview();

  ICoreWebView2 *webview = NULL;
  if (controller->lpVtbl->get_CoreWebView2 &&
      SUCCEEDED(controller->lpVtbl->get_CoreWebView2(controller, &webview)) && webview) {
    g_webview = webview;
    navigate_home();
  }

  focus_webview();
  return S_OK;
}

static HRESULT STDMETHODCALLTYPE env_invoke(Handler *self, HRESULT result,
                                            ICoreWebView2Environment *env) {
  (void)self;
  if (FAILED(result) || !env) {
    show_error(L"Не удалось запустить Microsoft Edge WebView2.\n\n"
               L"Установите Microsoft Edge WebView2 Runtime с сайта Microsoft и откройте "
               L"ByAzen снова.");
    PostQuitMessage(1);
    return S_OK;
  }

  g_env = env;
  g_ctrl_handler.lpVtbl = &g_ctrl_vtbl;
  g_ctrl_handler.ref = 1;
  g_ctrl_handler.kind = 1;

  HRESULT hr = env->lpVtbl->CreateCoreWebView2Controller(env, g_hwnd, &g_ctrl_handler);
  if (FAILED(hr)) {
    show_error(L"Не удалось инициализировать WebView2.");
    PostQuitMessage(1);
  }
  return S_OK;
}

static BOOL start_webview(void) {
  PFN_CreateEnvWithOptions create_env = NULL;
  if (!resolve_webview2(&create_env)) {
    show_error(L"Для работы ByAzen нужен Microsoft Edge WebView2 Runtime.\n\n"
               L"Он уже входит в Windows 11 и в свежие сборки Windows 10. Если его нет — "
               L"скачайте установщик «Evergreen Bootstrapper» на странице Microsoft Edge "
               L"WebView2 в интернете и запустите ByAzen снова.");
    return FALSE;
  }

  WCHAR user_data[MAX_PATH * 2];
  WCHAR local[MAX_PATH * 2];
  DWORD got = GetEnvironmentVariableW(L"LOCALAPPDATA", local, MAX_PATH * 2);
  if (got == 0 || got >= MAX_PATH * 2) {
    local[0] = L'\0';
    GetTempPathW(MAX_PATH * 2, local);
    join_path(user_data, MAX_PATH * 2, local, L"ByAzen");
  } else {
    join_path(user_data, MAX_PATH * 2, local, L"ByAzen\\WebView2");
  }
  SHCreateDirectoryExW(NULL, user_data, NULL);

  g_env_handler.lpVtbl = &g_env_vtbl;
  g_env_handler.ref = 1;
  g_env_handler.kind = 0;

  HRESULT hr = create_env(NULL, user_data, NULL, &g_env_handler);
  if (FAILED(hr)) {
    show_error(L"WebView2 Runtime не отвечает.\n\n"
               L"Переустановите Microsoft Edge WebView2 Runtime и попробуйте снова.");
    return FALSE;
  }
  return TRUE;
}

/* ------------------------------------------------------------------------- */
/* Window                                                                    */
/* ------------------------------------------------------------------------- */

static void apply_dark_frame(HWND hwnd) {
  typedef HRESULT(WINAPI * SetAttribute)(HWND, DWORD, LPCVOID, DWORD);
  HMODULE dwm = LoadLibraryW(L"dwmapi.dll");
  if (!dwm) return;
  SetAttribute set_attribute = (SetAttribute)(void *)GetProcAddress(dwm, "DwmSetWindowAttribute");
  if (!set_attribute) return;

  BOOL dark = TRUE;
  set_attribute(hwnd, 20, &dark, sizeof(dark)); /* DWMWA_USE_IMMERSIVE_DARK_MODE (1809+) */
  set_attribute(hwnd, 19, &dark, sizeof(dark)); /* same attribute before 1809 */

  COLORREF caption = RGB(9, 10, 13);
  set_attribute(hwnd, 35, &caption, sizeof(caption)); /* DWMWA_CAPTION_COLOR (Win11) */
  COLORREF text = RGB(233, 230, 222);
  set_attribute(hwnd, 36, &text, sizeof(text));       /* DWMWA_TEXT_COLOR (Win11) */
  COLORREF border = RGB(34, 36, 40);
  set_attribute(hwnd, 34, &border, sizeof(border));   /* DWMWA_BORDER_COLOR (Win11) */
}

static void save_placement(HWND hwnd) {
  WINDOWPLACEMENT placement;
  memset(&placement, 0, sizeof(placement));
  placement.length = sizeof(placement);
  if (!GetWindowPlacement(hwnd, &placement)) return;
  if (placement.showCmd == SW_SHOWMINIMIZED) return;

  RECT rc = placement.rcNormalPosition;
  WCHAR value[128];
  _snwprintf(value, 127, L"%ld,%ld,%ld,%ld,%d", rc.left, rc.top, rc.right - rc.left,
             rc.bottom - rc.top, placement.showCmd == SW_SHOWMAXIMIZED ? 1 : 0);
  value[127] = L'\0';

  HKEY key;
  if (RegCreateKeyExW(HKEY_CURRENT_USER, L"Software\\ByAzen\\Window", 0, NULL, 0,
                      KEY_WRITE, NULL, &key, NULL) != ERROR_SUCCESS)
    return;
  RegSetValueExW(key, L"Placement", 0, REG_SZ, (const BYTE *)value,
                 (DWORD)((wcslen(value) + 1) * sizeof(WCHAR)));
  RegCloseKey(key);
}

static BOOL load_placement(RECT *out, BOOL *maximized) {
  HKEY key;
  if (RegOpenKeyExW(HKEY_CURRENT_USER, L"Software\\ByAzen\\Window", 0, KEY_READ, &key) !=
      ERROR_SUCCESS)
    return FALSE;

  WCHAR value[128];
  DWORD type = 0;
  DWORD bytes = sizeof(value);
  LONG status = RegQueryValueExW(key, L"Placement", NULL, &type, (BYTE *)value, &bytes);
  RegCloseKey(key);
  if (status != ERROR_SUCCESS || type != REG_SZ) return FALSE;
  value[127] = L'\0';

  long left = 0;
  long top = 0;
  long width = 0;
  long height = 0;
  int state = 0;
  if (swscanf(value, L"%ld,%ld,%ld,%ld,%d", &left, &top, &width, &height, &state) != 5)
    return FALSE;
  if (width < 640 || height < 480 || width > 16000 || height > 16000) return FALSE;

  RECT candidate = {(LONG)left, (LONG)top, (LONG)(left + width), (LONG)(top + height)};
  MONITORINFO monitor;
  monitor.cbSize = sizeof(monitor);
  HMONITOR handle = MonitorFromRect(&candidate, MONITOR_DEFAULTTONULL);
  if (!handle || !GetMonitorInfoW(handle, &monitor)) {
    handle = MonitorFromRect(&candidate, MONITOR_DEFAULTTOPRIMARY);
    if (!handle || !GetMonitorInfoW(handle, &monitor)) return FALSE;
  }
  /* Keep at least a strip of the caption inside the work area. */
  if (candidate.left > monitor.rcWork.right - 120) return FALSE;
  if (candidate.top > monitor.rcWork.bottom - 80) return FALSE;
  if (candidate.right < monitor.rcWork.left + 120) return FALSE;

  *out = candidate;
  *maximized = state != 0;
  return TRUE;
}

static void show_error(const WCHAR *text) {
  MessageBoxW(g_hwnd, text, BYAZEN_TITLE, MB_ICONWARNING | MB_OK | MB_SETFOREGROUND);
}

static LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wparam, LPARAM lparam) {
  switch (msg) {
    case WM_SIZE:
      resize_webview();
      return 0;
    case WM_GETMINMAXINFO: {
      MINMAXINFO *limits = (MINMAXINFO *)lparam;
      limits->ptMinTrackSize.x = 900;
      limits->ptMinTrackSize.y = 600;
      return 0;
    }
    case WM_TIMER:
      if (wparam == BYAZEN_WATCHDOG) {
        KillTimer(hwnd, BYAZEN_WATCHDOG);
        if (!g_controller) {
          show_error(L"WebView2 не запустился за 20 секунд.\n\n"
                     L"Проверьте Microsoft Edge WebView2 Runtime: возможно, он повреждён или "
                     L"заблокирован политикой безопасности.");
          PostQuitMessage(1);
        }
        return 0;
      }
      return DefWindowProcW(hwnd, msg, wparam, lparam);
    case WM_DPICHANGED:
      resize_webview();
      return 0;
    case WM_SETFOCUS:
      focus_webview();
      return 0;
    case WM_ERASEBKGND: {
      RECT rc;
      GetClientRect(hwnd, &rc);
      FillRect((HDC)wparam, &rc, g_bg_brush);
      return 1;
    }
    case WM_CLOSE:
      save_placement(hwnd);
      DestroyWindow(hwnd);
      return 0;
    case WM_DESTROY: {
      ICoreWebView2Controller *controller = (ICoreWebView2Controller *)g_controller;
      if (controller && controller->lpVtbl && controller->lpVtbl->Close)
        controller->lpVtbl->Close(controller);
      g_controller = NULL;
      g_webview = NULL;
      PostQuitMessage(0);
      return 0;
    }
    default:
      return DefWindowProcW(hwnd, msg, wparam, lparam);
  }
}

static void enable_dpi_awareness(void) {
  typedef BOOL(WINAPI * SetProcessDpiAwarenessContextFn)(HANDLE);
  HMODULE user32 = GetModuleHandleW(L"user32.dll");
  if (!user32) return;
  SetProcessDpiAwarenessContextFn set_context =
      (SetProcessDpiAwarenessContextFn)(void *)GetProcAddress(user32,
                                                              "SetProcessDpiAwarenessContext");
  /* DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 == (HANDLE)-4 */
  if (set_context) set_context((HANDLE)(INT_PTR)-4);
}

static BOOL focus_existing_instance(void) {
  for (int attempt = 0; attempt < 40; attempt++) {
    HWND existing = FindWindowW(BYAZEN_CLASS, NULL);
    if (existing) {
      if (IsIconic(existing)) ShowWindow(existing, SW_RESTORE);
      SetForegroundWindow(existing);
      return TRUE;
    }
    Sleep(100);
  }
  return FALSE;
}

int WINAPI WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command_line, int show) {
  (void)previous;
  (void)command_line;
  (void)show;

  g_instance = instance;

  SetLastError(0);
  HANDLE mutex = CreateMutexW(NULL, TRUE, BYAZEN_MUTEX);
  if (mutex && GetLastError() == ERROR_ALREADY_EXISTS) {
    if (focus_existing_instance()) {
      CloseHandle(mutex);
      return 0;
    }
  }

  enable_dpi_awareness();
  CoInitializeEx(NULL, COINIT_APARTMENTTHREADED);

  g_port = start_server();
  if (g_port <= 0) {
    MessageBoxW(NULL, L"Не удалось запустить локальный сервер ByAzen.", BYAZEN_TITLE,
                MB_ICONERROR | MB_OK);
    return 1;
  }

  g_bg_brush = CreateSolidBrush(RGB(7, 8, 10));

  WNDCLASSEXW wc;
  memset(&wc, 0, sizeof(wc));
  wc.cbSize = sizeof(wc);
  wc.style = CS_HREDRAW | CS_VREDRAW;
  wc.lpfnWndProc = WndProc;
  wc.hInstance = instance;
  wc.hCursor = LoadCursorW(NULL, IDC_ARROW);
  wc.hbrBackground = g_bg_brush;
  wc.lpszClassName = BYAZEN_CLASS;
  wc.hIcon = (HICON)LoadImageW(instance, MAKEINTRESOURCEW(1), IMAGE_ICON, 0, 0,
                               LR_DEFAULTSIZE | LR_SHARED);
  wc.hIconSm = (HICON)LoadImageW(instance, MAKEINTRESOURCEW(1), IMAGE_ICON,
                                 GetSystemMetrics(SM_CXSMICON), GetSystemMetrics(SM_CYSMICON),
                                 LR_SHARED);
  if (!wc.hIcon) wc.hIcon = LoadIconW(NULL, IDI_APPLICATION);
  if (!wc.hIconSm) wc.hIconSm = wc.hIcon;

  if (!RegisterClassExW(&wc)) {
    MessageBoxW(NULL, L"Не удалось создать окно ByAzen.", BYAZEN_TITLE, MB_ICONERROR | MB_OK);
    return 1;
  }

  RECT work;
  SystemParametersInfoW(SPI_GETWORKAREA, 0, &work, 0);
  int work_w = work.right - work.left;
  int work_h = work.bottom - work.top;

  int width = 1440;
  int height = 900;
  if (width > work_w - 80) width = work_w - 80;
  if (height > work_h - 80) height = work_h - 80;
  if (width < 900) width = 900;
  if (height < 620) height = 620;

  int left = work.left + (work_w - width) / 2;
  int top = work.top + (work_h - height) / 2;
  if (left < work.left) left = work.left;
  if (top < work.top) top = work.top;

  RECT saved;
  BOOL maximized = FALSE;
  if (load_placement(&saved, &maximized)) {
    left = saved.left;
    top = saved.top;
    width = saved.right - saved.left;
    height = saved.bottom - saved.top;
  }

  g_hwnd = CreateWindowExW(0, BYAZEN_CLASS, BYAZEN_TITLE,
                           WS_OVERLAPPEDWINDOW | WS_CLIPCHILDREN, left, top, width, height, NULL,
                           NULL, instance, NULL);
  if (!g_hwnd) {
    MessageBoxW(NULL, L"Не удалось создать окно ByAzen.", BYAZEN_TITLE, MB_ICONERROR | MB_OK);
    return 1;
  }

  apply_dark_frame(g_hwnd);
  ShowWindow(g_hwnd, maximized ? SW_SHOWMAXIMIZED : SW_SHOW);
  UpdateWindow(g_hwnd);

  if (!start_webview()) {
    DestroyWindow(g_hwnd);
    return 1;
  }
  SetTimer(g_hwnd, BYAZEN_WATCHDOG, 20000, NULL);

  MSG msg;
  while (GetMessageW(&msg, NULL, 0, 0) > 0) {
    TranslateMessage(&msg);
    DispatchMessageW(&msg);
  }

  CoUninitialize();
  if (mutex) CloseHandle(mutex);
  return 0;
}
