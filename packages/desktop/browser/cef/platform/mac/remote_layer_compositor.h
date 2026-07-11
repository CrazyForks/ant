#ifndef ANT_DESKTOP_REMOTE_LAYER_COMPOSITOR_H
#define ANT_DESKTOP_REMOTE_LAYER_COMPOSITOR_H

#include "include/cef_render_handler.h"

bool InitializeRemoteLayerCompositor();
void PresentRemoteLayer(const CefAcceleratedPaintInfo &info);
void ResizeRemoteLayer(int width, int height, float scale);

#endif
