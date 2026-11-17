#pragma once

#include <Arduino.h>
#include "settings.h"

enum ScreenState : uint8_t {
  SCREEN_ACTIVE = 0,
  SCREEN_DIM = 1,
  SCREEN_OFF = 2
};

void powerInit(const DeviceConfig& cfg);
void powerUpdate(const DeviceConfig& cfg,
                 bool wifiConnected,
                 bool mqttConnected,
                 bool httpHealthy,
                 uint32_t sendPulseSeq);
bool powerNotifyTouch();  // Returns true if screen was dimmed/off (touch only wakes)
ScreenState powerGetScreenState();
bool powerIsScreenOff();
uint16_t powerGetLdrRaw();
uint8_t powerGetBacklightDuty();

void powerSetLedOverride(const char* mode);
const char* powerGetLedMode();
void powerSetRemoteScreenState(const char* state);
