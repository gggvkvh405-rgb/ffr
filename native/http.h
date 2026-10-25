/*
 * Portable HTTP layer of the ByAzen shell.
 *
 * The native window hosts the UI from a loopback origin, so the page gets real
 * localStorage/sessionStorage/fetch semantics. This module implements just
 * enough of HTTP/1.1 for that: three routes, no keep-alive, no chunking.
 *
 * Everything platform-specific is behind the byazen_* hooks below, which lets
 * the same code run under the Windows shell and under native/http_test.c.
 */

#ifndef BYAZEN_HTTP_H
#define BYAZEN_HTTP_H

#include <stddef.h>
#include <stdint.h>

/* Resource ids served by the shell. */
#define BYAZEN_RES_HTML 101
#define BYAZEN_RES_FAVICON 102

/* Returns the resource payload, or NULL. `size` receives the byte count. */
const void *byazen_resource(int id, unsigned long *size);

/* Writes up to `len` bytes; returns the number of bytes accepted or <= 0. */
int byazen_conn_send(uintptr_t conn, const void *data, int len);

/* Reads up to `len` bytes; returns the number of bytes read or <= 0. */
int byazen_conn_recv(uintptr_t conn, void *buffer, int len);

/* Half-closes and releases the connection. */
void byazen_conn_close(uintptr_t conn);

/* Hands an absolute http(s) URL (UTF-8) to the system browser. Non-zero on
 * success. */
int byazen_open_external(const char *url);

/* Called when the UI has mounted inside the shell (GET /ready). */
void byazen_page_ready(void);

/* Reads one request from `conn`, writes the response and closes `conn`. */
void byazen_http_serve(uintptr_t conn);

/* Exposed for tests. */
int byazen_url_decode(const char *src, char *dst, size_t dst_size);
int byazen_is_http_url(const char *url);

#endif /* BYAZEN_HTTP_H */
