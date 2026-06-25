#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include "ant.h"
#include "descriptors.h"
#include "internal.h"

#include "silver/engine.h"
#include "gc/modules.h"
#include "gc/roots.h"

#include "modules/async_hooks.h"
#include "modules/symbol.h"

static ant_value_t *g_async_hooks = NULL;
static size_t g_async_hooks_len = 0;
static size_t g_async_hooks_cap = 0;
static bool g_async_hooks_dispatching = false;

static ant_value_t async_resource_clone_store_map(ant_t *js, async_resource_t *base);
static bool async_hooks_has_enabled_hooks(void) { return g_async_hooks_len != 0; }

static ant_value_t async_hooks_call_hook(ant_t *js, ant_value_t hook, const char *name, ant_value_t *args, int nargs) {
  ant_value_t callbacks = js_get_slot(hook, SLOT_DATA);
  if (!is_object_type(callbacks)) return js_mkundef();

  ant_value_t fn = js_get(js, callbacks, name);
  if (!is_callable(fn)) return js_mkundef();

  return sv_vm_call(js->vm, js, fn, callbacks, args, nargs, NULL, false);
}

static void async_hooks_dispatch(ant_t *js, const char *name, ant_value_t *args, int nargs) {
  if (!js || g_async_hooks_len == 0 || g_async_hooks_dispatching) return;

  GC_ROOT_SAVE(root_mark, js);
  for (int i = 0; i < nargs; i++) GC_ROOT_PIN(js, args[i]);

  g_async_hooks_dispatching = true;
  for (size_t i = 0; i < g_async_hooks_len; i++) {
    ant_value_t hook = g_async_hooks[i];
    if (!is_object_type(hook)) continue;

    ant_value_t result = async_hooks_call_hook(js, hook, name, args, nargs);
    (void)result;
  }
  g_async_hooks_dispatching = false;
  GC_ROOT_RESTORE(js, root_mark);
}

static void async_hooks_emit_init(ant_t *js, async_resource_t *resource) {
  if (!resource || !async_hooks_has_enabled_hooks()) return;
  ant_value_t args[] = {
    js_mknum((double)resource->async_id),
    resource->type,
    js_mknum((double)resource->trigger_async_id),
    resource->resource_object,
  };
  async_hooks_dispatch(js, "init", args, 4);
}

void async_hooks_emit_before(ant_t *js, async_resource_t *resource) {
  if (!resource || !async_hooks_has_enabled_hooks()) return;
  ant_value_t args[] = { js_mknum((double)resource->async_id) };
  async_hooks_dispatch(js, "before", args, 1);
}

void async_hooks_emit_after(ant_t *js, async_resource_t *resource) {
  if (!resource || !async_hooks_has_enabled_hooks()) return;
  ant_value_t args[] = { js_mknum((double)resource->async_id) };
  async_hooks_dispatch(js, "after", args, 1);
}

static void async_hooks_emit_destroy(ant_t *js, async_resource_t *resource) {
  if (!resource || !async_hooks_has_enabled_hooks()) return;
  ant_value_t args[] = { js_mknum((double)resource->async_id) };
  async_hooks_dispatch(js, "destroy", args, 1);
}

static async_resource_t *async_resource_create(ant_t *js, ant_value_t type, ant_value_t resource_object, ant_value_t als_store_map) {
  async_resource_t *resource = (async_resource_t *)calloc(1, sizeof(*resource));
  if (!resource) return NULL;

  if (js->next_async_id < 1) js->next_async_id = 1;
  resource->async_id = ++js->next_async_id;
  resource->trigger_async_id = js->current_async_resource ? js->current_async_resource->async_id : 1;
  resource->type = type;
  resource->resource_object = resource_object;
  resource->als_store_map = als_store_map;
  resource->refcount = 1;
  resource->hooks_inited = async_hooks_has_enabled_hooks() ? 1 : 0;

  if (resource->hooks_inited) async_hooks_emit_init(js, resource);
  return resource;
}

static async_resource_t *async_resource_from_value(ant_value_t value) {
  if (vtype(value) != T_NTARG) return NULL;
  return (async_resource_t *)(uintptr_t)vdata(value);
}

static ant_value_t async_resource_to_value(async_resource_t *resource) {
  if (!resource) return js_mkundef();
  return mkval(T_NTARG, (uint64_t)(uintptr_t)resource);
}

static void async_resource_retain(async_resource_t *resource) {
  if (resource) resource->refcount++;
}

void async_hooks_async_resource_release(async_resource_t *resource) {
  if (!resource || resource->refcount == 0) return;
  resource->refcount--;
  if (resource->refcount != 0) return;
  free(resource);
}

void async_hooks_async_resource_destroy(ant_t *js, async_resource_t *resource) {
  if (!resource) return;
  if (resource->refcount == 0) return;
  if (resource->refcount > 1) {
    resource->refcount--;
    return;
  }
  if (resource->hooks_inited) async_hooks_emit_destroy(js, resource);
  resource->refcount = 0;
  free(resource);
}

async_resource_t *async_hooks_async_resource_capture(ant_t *js) {
  async_resource_t *resource = js ? js->current_async_resource : NULL;
  async_resource_retain(resource);
  return resource;
}

async_resource_t *async_hooks_async_resource_capture_or_create(ant_t *js, const char *type) {
  if (!js || !async_hooks_has_enabled_hooks()) return async_hooks_async_resource_capture(js);

  GC_ROOT_SAVE(root_mark, js);

  async_resource_t *base = js->current_async_resource;
  ant_value_t map = async_resource_clone_store_map(js, base);
  if (is_err(map)) {
    GC_ROOT_RESTORE(js, root_mark);
    return NULL;
  }
  GC_ROOT_PIN(js, map);

  ant_value_t resource_object = js_mkobj(js);
  if (is_err(resource_object)) {
    GC_ROOT_RESTORE(js, root_mark);
    return NULL;
  }
  GC_ROOT_PIN(js, resource_object);

  const char *type_name = type ? type : "AsyncResource";
  ant_value_t type_value = js_mkstr(js, type_name, strlen(type_name));
  if (is_err(type_value)) {
    GC_ROOT_RESTORE(js, root_mark);
    return NULL;
  }
  GC_ROOT_PIN(js, type_value);

  async_resource_t *resource = async_resource_create(js, type_value, resource_object, map);
  GC_ROOT_RESTORE(js, root_mark);
  return resource;
}

async_resource_t *async_hooks_async_resource_swap(ant_t *js, async_resource_t *resource) {
  async_resource_t *previous = js ? js->current_async_resource : NULL;
  if (js) js->current_async_resource = resource;
  return previous;
}

void async_hooks_async_resource_mark(ant_t *js, async_resource_t *resource, void (*mark)(ant_t *, ant_value_t)) {
  if (!resource || !mark) return;
  mark(js, resource->type);
  mark(js, resource->resource_object);
  mark(js, resource->als_store_map);
}

static ant_value_t async_resource_clone_store_map(ant_t *js, async_resource_t *base) {
  ant_value_t map = js_mkarr(js);
  if (is_err(map)) return map;

  ant_value_t base_map = base ? base->als_store_map : js_mkundef();
  ant_offset_t len = vtype(base_map) == T_ARR ? js_arr_len(js, base_map) : 0;
  for (ant_offset_t i = 0; i < len; i++)
    js_arr_push(js, map, js_arr_get(js, base_map, i));

  return map;
}

static ant_value_t async_resource_map_with_store(ant_t *js, async_resource_t *base, ant_value_t storage, ant_value_t store) {
  GC_ROOT_SAVE(root_mark, js);
  GC_ROOT_PIN(js, storage);
  GC_ROOT_PIN(js, store);

  ant_value_t map = async_resource_clone_store_map(js, base);
  if (is_err(map)) {
    GC_ROOT_RESTORE(js, root_mark);
    return map;
  }
  GC_ROOT_PIN(js, map);

  ant_value_t entry = js_mkarr(js);
  if (is_err(entry)) {
    GC_ROOT_RESTORE(js, root_mark);
    return entry;
  }
  GC_ROOT_PIN(js, entry);

  js_arr_push(js, entry, storage);
  js_arr_push(js, entry, store);
  js_arr_push(js, entry, js_get_slot(storage, SLOT_DATA));
  js_arr_push(js, map, entry);

  GC_ROOT_RESTORE(js, root_mark);
  return map;
}

static async_resource_t *async_resource_create_with_store(ant_t *js, ant_value_t storage, ant_value_t store) {
  GC_ROOT_SAVE(root_mark, js);
  GC_ROOT_PIN(js, storage);
  GC_ROOT_PIN(js, store);

  ant_value_t map = async_resource_map_with_store(js, js->current_async_resource, storage, store);
  if (is_err(map)) {
    GC_ROOT_RESTORE(js, root_mark);
    return NULL;
  }
  GC_ROOT_PIN(js, map);

  ant_value_t resource_object = js_mkobj(js);
  if (is_err(resource_object)) {
    GC_ROOT_RESTORE(js, root_mark);
    return NULL;
  }
  GC_ROOT_PIN(js, resource_object);

  ant_value_t type = js_mkstr(js, "AsyncLocalStorage", 17);
  if (is_err(type)) {
    GC_ROOT_RESTORE(js, root_mark);
    return NULL;
  }
  GC_ROOT_PIN(js, type);

  async_resource_t *resource = async_resource_create(js, type, resource_object, map);
  GC_ROOT_RESTORE(js, root_mark);
  return resource;
}

static ant_value_t async_local_storage_get_store_for(ant_t *js, ant_value_t storage) {
  async_resource_t *resource = js ? js->current_async_resource : NULL;
  ant_value_t map = resource ? resource->als_store_map : js_mkundef();
  ant_offset_t len = vtype(map) == T_ARR ? js_arr_len(js, map) : 0;
  ant_value_t generation = js_get_slot(storage, SLOT_DATA);

  for (ant_offset_t i = len; i > 0; i--) {
    ant_value_t entry = js_arr_get(js, map, i - 1);
    if (vtype(entry) != T_ARR || js_arr_len(js, entry) < 3) continue;
    if (js_arr_get(js, entry, 0) == storage && js_arr_get(js, entry, 2) == generation)
      return js_arr_get(js, entry, 1);
  }

  return js_mkundef();
}

static ant_value_t async_hooks_call_with_tail_args(ant_t *js, ant_value_t fn, ant_value_t this_arg, ant_value_t *args, int nargs, int start_idx) {
  int call_nargs = nargs - start_idx;
  if (call_nargs <= 0) return sv_vm_call(js->vm, js, fn, this_arg, NULL, 0, NULL, false);

  ant_value_t *call_args = (ant_value_t *)malloc((size_t)call_nargs * sizeof(ant_value_t));
  if (!call_args) return js_mkerr(js, "Out of memory");

  for (int i = 0; i < call_nargs; i++) call_args[i] = args[start_idx + i];
  ant_value_t result = sv_vm_call(js->vm, js, fn, this_arg, call_args, call_nargs, NULL, false);
  free(call_args);
  return result;
}

static ant_value_t async_local_storage_run(ant_params_t) {
  if (nargs < 2 || !is_callable(args[1])) {
    return js_mkerr(js, "AsyncLocalStorage.run(store, callback, ...args) requires a callback");
  }

  ant_value_t this_obj = js_getthis(js);
  if (!is_object_type(this_obj)) {
    return js_mkerr(js, "AsyncLocalStorage.run() requires an AsyncLocalStorage instance");
  }

  async_resource_t *next = async_resource_create_with_store(js, this_obj, args[0]);
  if (!next) return js_mkerr(js, "out of memory");

  async_resource_t *prev = async_hooks_async_resource_swap(js, next);
  ant_value_t result = async_hooks_call_with_tail_args(js, args[1], js_mkundef(), args, nargs, 2);
  async_hooks_async_resource_swap(js, prev);
  async_hooks_async_resource_destroy(js, next);
  return result;
}

static ant_value_t async_local_storage_exit(ant_params_t) {
  if (nargs < 1 || !is_callable(args[0])) {
    return js_mkerr(js, "AsyncLocalStorage.exit(callback, ...args) requires a callback");
  }

  ant_value_t this_obj = js_getthis(js);
  if (!is_object_type(this_obj)) {
    return js_mkerr(js, "AsyncLocalStorage.exit() requires an AsyncLocalStorage instance");
  }

  async_resource_t *next = async_resource_create_with_store(js, this_obj, js_mkundef());
  if (!next) return js_mkerr(js, "out of memory");

  async_resource_t *prev = async_hooks_async_resource_swap(js, next);
  ant_value_t result = async_hooks_call_with_tail_args(js, args[0], js_mkundef(), args, nargs, 1);
  async_hooks_async_resource_swap(js, prev);
  async_hooks_async_resource_destroy(js, next);
  return result;
}

static ant_value_t async_local_storage_enterWith(ant_params_t) {
  ant_value_t this_obj = js_getthis(js);
  if (!is_object_type(this_obj)) {
    return js_mkerr(js, "AsyncLocalStorage.enterWith() requires an AsyncLocalStorage instance");
  }

  async_resource_t *next = async_resource_create_with_store(js, this_obj, nargs > 0 ? args[0] : js_mkundef());
  if (!next) return js_mkerr(js, "out of memory");

  async_hooks_async_resource_swap(js, next);
  return js_mkundef();
}

static ant_value_t async_local_storage_getStore(ant_params_t) {
  ant_value_t this_obj = js_getthis(js);
  if (!is_object_type(this_obj)) return js_mkundef();
  return async_local_storage_get_store_for(js, this_obj);
}

static ant_value_t async_local_storage_disable(ant_params_t) {
  ant_value_t this_obj = js_getthis(js);
  if (is_object_type(this_obj)) {
    ant_value_t generation = js_get_slot(this_obj, SLOT_DATA);
    double next_generation = vtype(generation) == T_NUM ? js_getnum(generation) + 1 : 1;
    js_set_slot_wb(js, this_obj, SLOT_DATA, js_mknum(next_generation));
  }
  return js_mkundef();
}

static void async_resource_finalize(ant_t *js, ant_object_t *obj) {
  (void)js;
  async_resource_t *resource = async_resource_from_value(js_get_slot(js_obj_from_ptr(obj), SLOT_DATA));
  async_hooks_async_resource_release(resource);
}

static ant_value_t async_resource_ctor(ant_params_t) {
  if (vtype(js->new_target) == T_UNDEF)
    return js_mkerr_typed(js, JS_ERR_TYPE, "AsyncResource constructor requires 'new'");

  GC_ROOT_SAVE(root_mark, js);

  ant_value_t obj = js_mkobj(js);
  GC_ROOT_PIN(js, obj);
  ant_value_t proto = js_instance_proto_from_new_target(js, js_mkundef());
  if (is_object_type(proto)) js_set_proto_init(obj, proto);

  ant_value_t map = async_resource_clone_store_map(js, js->current_async_resource);
  if (is_err(map)) {
    GC_ROOT_RESTORE(js, root_mark);
    return map;
  }
  GC_ROOT_PIN(js, map);

  ant_value_t type = js_mkstr(js, "AsyncResource", 13);
  if (nargs > 0 && vtype(args[0]) == T_STR) type = args[0];
  if (is_err(type)) {
    GC_ROOT_RESTORE(js, root_mark);
    return type;
  }
  GC_ROOT_PIN(js, type);

  async_resource_t *resource = async_resource_create(js, type, obj, map);
  if (!resource) {
    GC_ROOT_RESTORE(js, root_mark);
    return js_mkerr(js, "out of memory");
  }

  js_set_slot(obj, SLOT_DATA, async_resource_to_value(resource));
  js_set_finalizer(obj, async_resource_finalize);
  GC_ROOT_RESTORE(js, root_mark);
  return obj;
}

static ant_value_t async_resource_runInAsyncScope(ant_params_t) {
  if (nargs < 1 || !is_callable(args[0])) {
    return js_mkerr(js, "AsyncResource.runInAsyncScope(fn[, thisArg, ...args]) requires a function");
  }
  ant_value_t this_arg = nargs > 1 ? args[1] : js_mkundef();
  async_resource_t *resource = async_resource_from_value(js_get_slot(js_getthis(js), SLOT_DATA));
  async_resource_t *prev = async_hooks_async_resource_swap(js, resource);
  async_hooks_emit_before(js, resource);
  ant_value_t result = async_hooks_call_with_tail_args(js, args[0], this_arg, args, nargs, 2);
  async_hooks_emit_after(js, resource);
  async_hooks_async_resource_swap(js, prev);
  return result;
}

static ant_value_t async_resource_emitDestroy(ant_params_t) {
  ant_value_t this_obj = js_getthis(js);
  async_resource_t *resource = async_resource_from_value(js_get_slot(this_obj, SLOT_DATA));
  if (resource) {
    async_hooks_async_resource_destroy(js, resource);
    js_set_slot(this_obj, SLOT_DATA, js_mkundef());
  }
  return this_obj;
}

static ant_value_t async_resource_asyncId(ant_params_t) {
  async_resource_t *resource = async_resource_from_value(js_get_slot(js_getthis(js), SLOT_DATA));
  return js_mknum(resource ? (double)resource->async_id : 0);
}

static ant_value_t async_resource_triggerAsyncId(ant_params_t) {
  async_resource_t *resource = async_resource_from_value(js_get_slot(js_getthis(js), SLOT_DATA));
  return js_mknum(resource ? (double)resource->trigger_async_id : 0);
}

static ant_value_t async_hook_enable(ant_params_t) {
  ant_value_t this_obj = js_getthis(js);
  if (!is_object_type(this_obj)) return this_obj;
  if (js_get_slot(this_obj, SLOT_AUX) == js_true) return this_obj;

  if (g_async_hooks_len == g_async_hooks_cap) {
    size_t next_cap = g_async_hooks_cap ? g_async_hooks_cap * 2 : 4;
    ant_value_t *next = (ant_value_t *)realloc(g_async_hooks, next_cap * sizeof(*next));
    if (!next) return js_mkerr(js, "out of memory");
    g_async_hooks = next;
    g_async_hooks_cap = next_cap;
  }

  g_async_hooks[g_async_hooks_len++] = this_obj;
  js_set_slot(this_obj, SLOT_AUX, js_true);
  return this_obj;
}

static ant_value_t async_hook_disable(ant_params_t) {
  ant_value_t this_obj = js_getthis(js);
  if (!is_object_type(this_obj)) return this_obj;
  if (js_get_slot(this_obj, SLOT_AUX) != js_true) return this_obj;

  for (size_t i = 0; i < g_async_hooks_len; i++) {
    if (g_async_hooks[i] != this_obj) continue;
    if (i + 1 < g_async_hooks_len)
      memmove(&g_async_hooks[i], &g_async_hooks[i + 1], (g_async_hooks_len - i - 1) * sizeof(*g_async_hooks));
    g_async_hooks_len--;
    break;
  }

  js_set_slot(this_obj, SLOT_AUX, js_false);
  return this_obj;
}

static ant_value_t async_hooks_createHook(ant_params_t) {
  if (nargs < 1 || !is_object_type(args[0]))
    return js_mkerr(js, "async_hooks.createHook(callbacks) requires an object");

  ant_value_t hook = js_mkobj(js);
  js_set_slot_wb(js, hook, SLOT_DATA, args[0]);
  js_set_slot(hook, SLOT_AUX, js_false);
  js_set(js, hook, "enable", js_mkfun(async_hook_enable));
  js_set(js, hook, "disable", js_mkfun(async_hook_disable));
  return hook;
}

static ant_value_t async_hooks_executionAsyncId(ant_params_t) {
  async_resource_t *resource = js ? js->current_async_resource : NULL;
  return js_mknum(resource ? (double)resource->async_id : 1);
}

static ant_value_t async_hooks_triggerAsyncId(ant_params_t) {
  async_resource_t *resource = js ? js->current_async_resource : NULL;
  return js_mknum(resource ? (double)resource->trigger_async_id : 0);
}

static ant_value_t async_hooks_executionAsyncResource(ant_params_t) {
  async_resource_t *resource = js ? js->current_async_resource : NULL;
  return resource ? resource->resource_object : js_mkobj(js);
}

void gc_mark_async_hooks(ant_t *js, gc_mark_fn mark) {
  if (!mark) return;
  for (size_t i = 0; i < g_async_hooks_len; i++)
    mark(js, g_async_hooks[i]);
}

ant_value_t async_hooks_library(ant_t *js) {
  ant_value_t lib = js_mkobj(js);

  ant_value_t als_ctor = js_mkobj(js);
  ant_value_t als_proto = js_mkobj(js);
  js_set(js, als_proto, "run", js_mkfun(async_local_storage_run));
  js_set(js, als_proto, "exit", js_mkfun(async_local_storage_exit));
  js_set(js, als_proto, "enterWith", js_mkfun(async_local_storage_enterWith));
  js_set(js, als_proto, "getStore", js_mkfun(async_local_storage_getStore));
  js_set(js, als_proto, "disable", js_mkfun(async_local_storage_disable));
  js_set_sym(js, als_proto, get_toStringTag_sym(), ANT_STRING("AsyncLocalStorage"));
  js_mkprop_fast(js, als_ctor, "prototype", 9, als_proto);
  js_mkprop_fast(js, als_ctor, "name", 4, ANT_STRING("AsyncLocalStorage"));
  js_set_descriptor(js, als_ctor, "name", 4, 0);
  js_set(js, lib, "AsyncLocalStorage", js_obj_to_func_ex(als_ctor, SV_CALL_IS_DEFAULT_CTOR));

  ant_value_t resource_ctor = js_mkobj(js);
  ant_value_t resource_proto = js_mkobj(js);
  js_set_slot_wb(js, resource_ctor, SLOT_CFUNC, js_mkfun_arity(async_resource_ctor, 1));
  js_set(js, resource_proto, "runInAsyncScope", js_mkfun(async_resource_runInAsyncScope));
  js_set(js, resource_proto, "emitDestroy", js_mkfun(async_resource_emitDestroy));
  js_set(js, resource_proto, "asyncId", js_mkfun(async_resource_asyncId));
  js_set(js, resource_proto, "triggerAsyncId", js_mkfun(async_resource_triggerAsyncId));
  js_set_sym(js, resource_proto, get_toStringTag_sym(), ANT_STRING("AsyncResource"));
  js_mkprop_fast(js, resource_ctor, "prototype", 9, resource_proto);
  js_mkprop_fast(js, resource_ctor, "name", 4, ANT_STRING("AsyncResource"));
  js_set_descriptor(js, resource_ctor, "name", 4, 0);
  js_mark_constructor(resource_ctor, true);
  js_set(js, lib, "AsyncResource", js_obj_to_func(resource_ctor));

  js_set(js, lib, "createHook", js_mkfun(async_hooks_createHook));
  js_set(js, lib, "executionAsyncId", js_mkfun(async_hooks_executionAsyncId));
  js_set(js, lib, "triggerAsyncId", js_mkfun(async_hooks_triggerAsyncId));
  js_set(js, lib, "executionAsyncResource", js_mkfun(async_hooks_executionAsyncResource));
  js_set(js, lib, "asyncWrapProviders", js_mkobj(js));
  js_set_sym(js, lib, get_toStringTag_sym(), ANT_STRING("async_hooks"));

  return lib;
}
