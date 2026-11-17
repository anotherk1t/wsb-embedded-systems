#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include "config.h"
#include "gps.h"
#include "sensors.h"
#include "settings.h"

enum TsSource : uint8_t {
  TS_NONE = 0,
  TS_NTP = 1,
  TS_GPS = 2
};

// Bitmasks for optional telemetry fields
enum GpsValidBits : uint8_t {
  GPS_BIT_ALT = 1 << 0,
  GPS_BIT_SPEED = 1 << 1,
  GPS_BIT_COURSE = 1 << 2,
  GPS_BIT_HDOP = 1 << 3,
  GPS_BIT_SATS = 1 << 4
};

enum EnvValidBits : uint16_t {
  ENV_BIT_TEMP = 1 << 0,
  ENV_BIT_HUM = 1 << 1,
  ENV_BIT_PRES = 1 << 2,
  ENV_BIT_GAS = 1 << 3,
  ENV_BIT_AQI = 1 << 4,
  ENV_BIT_ECO2 = 1 << 5,
  ENV_BIT_TVOC = 1 << 6
};

struct TelemetrySample {
  uint32_t seq = 0;
  int64_t ts_epoch_ms = 0;
  uint32_t uptime_ms = 0;
  uint8_t ts_source = TS_NONE;
  bool replay = false;

  // GPS
  bool gps_fix = false;
  double lat = 0.0;
  double lon = 0.0;
  float gps_alt = 0.0f;
  float speed_kmh = 0.0f;
  float course = 0.0f;
  float hdop = 0.0f;
  uint8_t sats = 0;
  uint8_t gps_valid_mask = 0;

  // Environmental
  float temp_c = 0.0f;
  float humidity = 0.0f;
  float pressure_hpa = 0.0f;
  float gas_kohm = 0.0f;
  int16_t aqi = 0;
  uint8_t aqi_source = AQI_NONE;
  uint16_t eco2_ppm = 0;
  uint16_t tvoc_ppb = 0;
  uint16_t env_valid_mask = 0;

  // System
  int16_t rssi = 0;
  bool rssi_valid = false;
  uint32_t heap = 0;
  uint16_t buffered = 0;
  uint32_t cfg_version = 0;
};

void telemetryInit();

TelemetrySample telemetryBuildSample(uint32_t seq,
                                     const EnvReading& env,
                                     const GpsReading& gps,
                                     const DeviceConfig& cfg,
                                     bool wifiConnected,
                                     int16_t rssi,
                                     bool ntpSynced,
                                     int64_t ntpEpochMs,
                                     bool canSendLive);

void telemetryBufferPush(const TelemetrySample& sample);
size_t telemetryBufferCount();
size_t telemetryBufferCapacity();
uint32_t telemetryBufferDroppedCount();
size_t telemetryBufferPeekBatch(TelemetrySample* out, size_t maxCount);
void telemetryBufferPopCount(size_t count);
void telemetryBufferMarkReplay(size_t count);

void telemetryFormatIsoUtc(int64_t epochMs, char* buf, size_t len);
size_t telemetrySerializeSingle(const TelemetrySample& s, char* outBuf, size_t maxLen);
bool telemetrySerializeArray(const TelemetrySample* samples, size_t count, String& outJson);
