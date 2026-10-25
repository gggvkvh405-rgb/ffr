/*
 * Portable HTTP layer of the ByAzen shell — see native/http.h.
 *
 * The browser engine talks to this server only on 127.0.0.1 and only to load
 * the app itself or to hand a link to the system browser.
 */

#include "http.h"

#include <stdio.h>
#include <string.h>

#ifdef _WIN32
#define snprintf_compat _snprintf
#define strnicmp_compat _strnicmp
#else
#include <strings.h>
#define snprintf_compat snprintf
#define strnicmp_compat strncasecmp
#endif

#define REQ_MAX 8192
#define PATH_MAX_BYTES 3072

static void send_all(uintptr_t conn, const char *buf, int len) {
  int sent = 0;
  while (sent < len) {
    int chunk = byazen_conn_send(conn, buf + sent, len - sent);
    if (chunk <= 0) return;
    sent += chunk;
  }
}

static void send_str(uintptr_t conn, const char *text) {
  send_all(conn, text, (int)strlen(text));
}

static void send_headers(uintptr_t conn, const char *status, const char *content_type,
                         long length) {
  char head[512];
  int n = snprintf_compat(head, sizeof(head) - 1,
                    "HTTP/1.1 %s\r\n"
                    "Content-Type: %s\r\n"
                    "Content-Length: %ld\r\n"
                    "Cache-Control: no-store, max-age=0\r\n"
                    "X-Content-Type-Options: nosniff\r\n"
                    "Connection: close\r\n"
                    "\r\n",
                    status, content_type, length);
  if (n > 0) send_all(conn, head, n);
}

static void respond_text(uintptr_t conn, const char *status, const char *body) {
  send_headers(conn, status, "text/plain; charset=utf-8", (long)strlen(body));
  send_str(conn, body);
}

static void respond_resource(uintptr_t conn, int id, const char *content_type) {
  unsigned long size = 0;
  const char *data = (const char *)byazen_resource(id, &size);
  if (!data) {
    respond_text(conn, "500 Internal Server Error", "resource missing");
    return;
  }
  send_headers(conn, "200 OK", content_type, (long)size);
  send_all(conn, data, (int)size);
}

static int hex_value(int c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

int byazen_url_decode(const char *src, char *dst, size_t dst_size) {
  size_t out = 0;
  if (!src || !dst || dst_size == 0) return 0;
  while (*src && out + 1 < dst_size) {
    if (*src == '%' && hex_value(src[1]) >= 0 && hex_value(src[2]) >= 0) {
      dst[out++] = (char)(hex_value(src[1]) * 16 + hex_value(src[2]));
      src += 3;
    } else if (*src == '+') {
      dst[out++] = ' ';
      src++;
    } else {
      dst[out++] = *src++;
    }
  }
  dst[out] = '\0';
  return (int)out;
}

int byazen_is_http_url(const char *url) {
  if (!url) return 0;
  return strnicmp_compat(url, "http://", 7) == 0 || strnicmp_compat(url, "https://", 8) == 0;
}

static void handle_open(uintptr_t conn, const char *query) {
  char encoded[PATH_MAX_BYTES];
  char decoded[PATH_MAX_BYTES];

  const char *found = query ? strstr(query, "url=") : NULL;
  if (!found) {
    respond_text(conn, "400 Bad Request", "missing url");
    return;
  }
  found += 4;

  size_t len = strcspn(found, "&");
  if (len >= sizeof(encoded)) len = sizeof(encoded) - 1;
  memcpy(encoded, found, len);
  encoded[len] = '\0';

  byazen_url_decode(encoded, decoded, sizeof(decoded));
  if (!byazen_is_http_url(decoded)) {
    respond_text(conn, "400 Bad Request", "scheme not allowed");
    return;
  }

  if (!byazen_open_external(decoded)) {
    respond_text(conn, "500 Internal Server Error", "cannot launch browser");
    return;
  }
  respond_text(conn, "200 OK", "ok");
}

void byazen_http_serve(uintptr_t conn) {
  char request[REQ_MAX + 1];
  char method[8] = {0};
  char target[PATH_MAX_BYTES] = {0};
  char path[PATH_MAX_BYTES] = {0};
  char query[PATH_MAX_BYTES] = {0};
  int total = 0;

  while (total < REQ_MAX) {
    int got = byazen_conn_recv(conn, request + total, REQ_MAX - total);
    if (got <= 0) break;
    total += got;
    request[total] = '\0';
    if (strstr(request, "\r\n\r\n")) break;
  }

  if (total <= 0) {
    byazen_conn_close(conn);
    return;
  }

  if (sscanf(request, "%7s %3071s", method, target) != 2) {
    respond_text(conn, "400 Bad Request", "bad request");
    byazen_conn_close(conn);
    return;
  }

  int is_head = strcmp(method, "HEAD") == 0;
  int is_get = strcmp(method, "GET") == 0 || is_head;

  char *question = strchr(target, '?');
  if (question) {
    size_t path_len = (size_t)(question - target);
    if (path_len >= sizeof(path)) path_len = sizeof(path) - 1;
    memcpy(path, target, path_len);
    path[path_len] = '\0';
    snprintf(query, sizeof(query), "%s", question + 1);
  } else {
    snprintf(path, sizeof(path), "%s", target);
  }

  if (!is_get) {
    respond_text(conn, "405 Method Not Allowed", "method not allowed");
  } else if (strcmp(path, "/") == 0 || strcmp(path, "/index.html") == 0) {
    if (is_head) {
      unsigned long size = 0;
      byazen_resource(BYAZEN_RES_HTML, &size);
      send_headers(conn, "200 OK", "text/html; charset=utf-8", (long)size);
    } else {
      respond_resource(conn, BYAZEN_RES_HTML, "text/html; charset=utf-8");
    }
  } else if (strcmp(path, "/favicon.svg") == 0) {
    respond_resource(conn, BYAZEN_RES_FAVICON, "image/svg+xml");
  } else if (strcmp(path, "/open") == 0) {
    handle_open(conn, query);
  } else if (strcmp(path, "/health") == 0) {
    respond_text(conn, "200 OK", "byazen");
  } else {
    respond_text(conn, "404 Not Found", "not found");
  }

  byazen_conn_close(conn);
}
