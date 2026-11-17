#pragma once

#include <Arduino.h>

struct DeviceConfig {
  uint32_t version = 0;
  uint16_t telemetry_interval_s = 10;
  float temp_offset_c = 0.0f;
  float humidity_offset = 0.0f;
  float pressure_offset_hpa = 0.0f;
  float sea_level_hpa = 1013.25f;
  float gas_baseline_kohm = 0.0f;
  uint8_t display_brightness = 200;
  bool auto_brightness = true;
  uint16_t screen_dim_s = 30;
  uint16_t screen_off_s = 120;
  uint32_t gps_baud = 9600;
};

struct DeviceCredentials {
  String wifi_ssid;
  String wifi_pass;
  String device_id;
  String device_key;
};

void settingsInit();
DeviceConfig settingsGet();
bool settingsApplyJson(const char* json, size_t len, bool* gpsBaudChanged = nullptr);
void settingsSetDisplayBrightness(uint8_t brightness);

DeviceCredentials settingsGetCredentials();
void settingsGetDeviceId(char* outBuf, size_t maxLen);
bool settingsHasWifiCredentials();
bool settingsSaveCredentials(const String& wifiSsid,
                             const String& wifiPass,
                             const String& deviceId = "");
bool settingsSaveDeviceAuth(const String& deviceId, const String& deviceKey);
