#ifndef ANT_ASYNC_HOOKS_MODULE_H
#define ANT_ASYNC_HOOKS_MODULE_H

#include "types.h"

#include <stdint.h>

typedef struct async_resource {
  uint64_t async_id;
  uint64_t trigger_async_id;
  ant_value_t type;
  ant_value_t resource_object;
  ant_value_t als_store_map;
  uint32_t refcount;
  uint8_t hooks_inited;
} async_resource_t;

ant_value_t async_hooks_library(ant_t *js);

async_resource_t *async_hooks_async_resource_capture(ant_t *js);
async_resource_t *async_hooks_async_resource_capture_or_create(ant_t *js, const char *type);
async_resource_t *async_hooks_async_resource_swap(ant_t *js, async_resource_t *resource);

void async_hooks_async_resource_release(async_resource_t *resource);
void async_hooks_async_resource_destroy(ant_t *js, async_resource_t *resource);

void async_hooks_emit_before(ant_t *js, async_resource_t *resource);
void async_hooks_emit_after(ant_t *js, async_resource_t *resource);

void async_hooks_async_resource_mark(
  ant_t *js,
  async_resource_t *resource,
  void (*mark)(ant_t *, ant_value_t)
);

#endif
