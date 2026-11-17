#pragma once

#include <Arduino.h>
#include "gps.h"
#include "net.h"
#include "sensors.h"
#include "settings.h"

enum UiPage : uint8_t {
  PAGE_ENV = 0,
  PAGE_GPS = 1,
  PAGE_QR = 2,
  PAGE_SYS = 3,
  PAGE_COUNT = 4
};

void uiInit();
void uiShowSplash();
void uiSplashStep(bool ok, const char* text);
void uiBeginLive(UiPage initialPage = PAGE_ENV);

void uiSetPage(UiPage page);
UiPage uiGetPage();
void uiToggleInvertDisplay();
bool uiIsDisplayInverted();

// Thread-safe onboard toast banner (x=16..304, y=28..54)
void uiShowToast(const char* msg, uint32_t durationMs = 3500);

// Polls touch; handles wake-only on dimmed/off screen, bottom tabs, QR setup toggle, and page cycling.
void uiPollTouch();

// Redraws status bar + active page values at refresh cadence (no-op if screen is OFF).
void uiUpdate(const EnvReading& env,
              const GpsReading& gps,
              const NetStatus& net,
              const DeviceConfig& cfg,
              size_t bufferedCount,
              bool forceRedraw = false);
