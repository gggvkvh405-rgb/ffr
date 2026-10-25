/*
 * Test harness for native/http.c.
 *
 * Runs the exact production HTTP handler on top of POSIX sockets so the
 * routing, header building and URL handling can be exercised without Windows:
 *
 *   cc -O2 -std=c11 -o http_test native/tests/http_test.c native/http.c
 *   BYAZEN_TEST_HTML=dist-desktop/index.html ./http_test 47899
 */

#define _POSIX_C_SOURCE 200809L

#include "../http.h"

#include <arpa/inet.h>
#include <netinet/in.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <unistd.h>

static char *g_html;
static unsigned long g_html_size;
static char g_favicon[] = "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>";

static int load_html(void) {
  const char *path = getenv("BYAZEN_TEST_HTML");
  if (!path) path = "dist-desktop/index.html";
  FILE *file = fopen(path, "rb");
  if (!file) {
    fprintf(stderr, "cannot open %s\n", path);
    return 0;
  }
  fseek(file, 0, SEEK_END);
  long size = ftell(file);
  fseek(file, 0, SEEK_SET);
  if (size <= 0) {
    fclose(file);
    return 0;
  }
  g_html = malloc((size_t)size);
  if (!g_html || fread(g_html, 1, (size_t)size, file) != (size_t)size) {
    fclose(file);
    return 0;
  }
  fclose(file);
  g_html_size = (unsigned long)size;
  return 1;
}

const void *byazen_resource(int id, unsigned long *size) {
  if (id == BYAZEN_RES_HTML) {
    if (size) *size = g_html_size;
    return g_html;
  }
  if (id == BYAZEN_RES_FAVICON) {
    if (size) *size = sizeof(g_favicon) - 1;
    return g_favicon;
  }
  return NULL;
}

int byazen_conn_send(uintptr_t conn, const void *data, int len) {
  return (int)send((int)conn, data, (size_t)len, 0);
}

int byazen_conn_recv(uintptr_t conn, void *buffer, int len) {
  return (int)recv((int)conn, buffer, (size_t)len, 0);
}

void byazen_conn_close(uintptr_t conn) {
  int fd = (int)conn;
  shutdown(fd, SHUT_WR);
  close(fd);
}

int byazen_open_external(const char *url) {
  printf("OPEN %s\n", url);
  fflush(stdout);
  return strstr(url, "deny") == NULL;
}

void byazen_page_ready(void) {
  printf("PING\n");
  fflush(stdout);
}

int main(int argc, char **argv) {
  int port = argc > 1 ? atoi(argv[1]) : 47899;
  if (!load_html()) return 2;

  int listener = socket(AF_INET, SOCK_STREAM, 0);
  if (listener < 0) {
    perror("socket");
    return 2;
  }
  int reuse = 1;
  setsockopt(listener, SOL_SOCKET, SO_REUSEADDR, &reuse, sizeof(reuse));

  struct sockaddr_in addr;
  memset(&addr, 0, sizeof(addr));
  addr.sin_family = AF_INET;
  addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  addr.sin_port = htons((unsigned short)port);

  if (bind(listener, (struct sockaddr *)&addr, sizeof(addr)) != 0) {
    perror("bind");
    return 2;
  }
  if (listen(listener, 16) != 0) {
    perror("listen");
    return 2;
  }

  printf("READY %d\n", port);
  fflush(stdout);

  for (;;) {
    int client = accept(listener, NULL, NULL);
    if (client < 0) break;
    byazen_http_serve((uintptr_t)client);
  }
  return 0;
}
