#include "telemetry.h"

#include <cmath>
#include <ctime>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>

namespace {

TelemetrySample s_ring[TELEMETRY_BUFFER_CAPACITY];
size_t s_head = 0;
size_t s_count = 0;
uint32_t s_dropped = 0;
SemaphoreHandle_t s_bufMutex = nullptr;

float round2(float v) {
  return roundf(v * 100.0f) / 100.0f;
}

float round1(float v) {
  return roundf(v * 10.0f) / 10.0f;
}

double round6(double v) {
  return round(v * 1000000.0) / 1000000.0;
}

const char* tsSourceStr(uint8_t src) {
  switch (src) {
    case TS_NTP: return "ntp";
    case TS_GPS: return "gps";
    default: return "none";
  }
}

const char* aqiSourceStr(uint8_t src) {
  switch (src) {
    case AQI_BME680_IAQ: return "bme680_iaq";
    case AQI_ENS160: return "ens160";
    default: return "none";
  }
}

void populateJsonObject(const TelemetrySample& s, JsonObject obj, const char* deviceId) {
  obj["device_id"] = deviceId;
  obj["seq"] = s.seq;

  if (s.ts_source != TS_NONE && s.ts_epoch_ms > 0) {
    char tsBuf[32];
    telemetryFormatIsoUtc(s.ts_epoch_ms, tsBuf, sizeof(tsBuf));
    obj["ts"] = tsBuf;
  } else {
    obj["ts"] = nullptr;
  }

  obj["ts_source"] = tsSourceStr(s.ts_source);
  obj["uptime_ms"] = s.uptime_ms;
  obj["replay"] = s.replay;

  JsonObject gpsObj = obj["gps"].to<JsonObject>();
  gpsObj["fix"] = s.gps_fix;
  if (s.gps_fix) {
    gpsObj["lat"] = round6(s.lat);
    gpsObj["lon"] = round6(s.lon);
  } else {
    gpsObj["lat"] = nullptr;
    gpsObj["lon"] = nullptr;
  }
  if (s.gps_fix && (s.gps_valid_mask & GPS_BIT_ALT)) {
    gpsObj["alt"] = round1(s.gps_alt);
  } else {
    gpsObj["alt"] = nullptr;
  }
  if (s.gps_fix && (s.gps_valid_mask & GPS_BIT_SPEED)) {
    gpsObj["speed_kmh"] = round2(s.speed_kmh);
  } else {
    gpsObj["speed_kmh"] = nullptr;
  }
  if (s.gps_fix && (s.gps_valid_mask & GPS_BIT_COURSE)) {
    gpsObj["course"] = round1(s.course);
  } else {
    gpsObj["course"] = nullptr;
  }
  if (s.gps_valid_mask & GPS_BIT_SATS) {
    gpsObj["sats"] = s.sats;
  } else {
    gpsObj["sats"] = nullptr;
  }
  if (s.gps_valid_mask & GPS_BIT_HDOP) {
    gpsObj["hdop"] = round2(s.hdop);
  } else {
    gpsObj["hdop"] = nullptr;
  }

  JsonObject envObj = obj["env"].to<JsonObject>();
  if (s.env_valid_mask & ENV_BIT_TEMP) {
    envObj["temp_c"] = round2(s.temp_c);
  } else {
    envObj["temp_c"] = nullptr;
  }
  if (s.env_valid_mask & ENV_BIT_HUM) {
    envObj["humidity"] = round2(s.humidity);
  } else {
    envObj["humidity"] = nullptr;
  }
  if (s.env_valid_mask & ENV_BIT_PRES) {
    envObj["pressure_hpa"] = round2(s.pressure_hpa);
  } else {
    envObj["pressure_hpa"] = nullptr;
  }
  if (s.env_valid_mask & ENV_BIT_GAS) {
    envObj["gas_kohm"] = round2(s.gas_kohm);
  } else {
    envObj["gas_kohm"] = nullptr;
  }
  if (s.env_valid_mask & ENV_BIT_AQI) {
    envObj["aqi"] = s.aqi;
  } else {
    envObj["aqi"] = nullptr;
  }
  envObj["aqi_source"] = aqiSourceStr(s.aqi_source);
  if (s.env_valid_mask & ENV_BIT_ECO2) {
    envObj["eco2_ppm"] = s.eco2_ppm;
  } else {
    envObj["eco2_ppm"] = nullptr;
  }
  if (s.env_valid_mask & ENV_BIT_TVOC) {
    envObj["tvoc_ppb"] = s.tvoc_ppb;
  } else {
    envObj["tvoc_ppb"] = nullptr;
  }

  JsonObject sysObj = obj["sys"].to<JsonObject>();
  if (s.rssi_valid) {
    sysObj["rssi"] = s.rssi;
  } else {
    sysObj["rssi"] = nullptr;
  }
  sysObj["heap"] = s.heap;
  sysObj["buffered"] = s.buffered;
  sysObj["fw"] = FW_VERSION;
  sysObj["cfg_version"] = s.cfg_version;
}

}  // namespace

void telemetryInit() {
  if (!s_bufMutex) {
    s_bufMutex = xSemaphoreCreateMutex();
  }
}

TelemetrySample telemetryBuildSample(uint32_t seq,
                                     const EnvReading& env,
                                     const GpsReading& gps,
                                     const DeviceConfig& cfg,
                                     bool wifiConnected,
                                     int16_t rssi,
                                     bool ntpSynced,
                                     int64_t ntpEpochMs,
                                     bool canSendLive) {
  TelemetrySample s;
  s.seq = seq;
  s.uptime_ms = millis();

  if (ntpSynced && ntpEpochMs > 0) {
    s.ts_source = TS_NTP;
    s.ts_epoch_ms = ntpEpochMs;
  } else if (gps.utcValid && gps.utcEpochMs > 0) {
    s.ts_source = TS_GPS;
    s.ts_epoch_ms = gps.utcEpochMs;
  } else {
    s.ts_source = TS_NONE;
    s.ts_epoch_ms = 0;
  }

  size_t queued = telemetryBufferCount();
  s.replay = (!canSendLive) || (queued > 0);
  s.buffered = static_cast<uint16_t>(min<size_t>(queued, 65535));

  // GPS
  s.gps_fix = gps.fix && gps.latLonValid;
  if (s.gps_fix) {
    s.lat = gps.lat;
    s.lon = gps.lon;
    if (gps.altValid) {
      s.gps_alt = gps.altM;
      s.gps_valid_mask |= GPS_BIT_ALT;
    }
    if (gps.speedValid) {
      s.speed_kmh = gps.speedKmh;
      s.gps_valid_mask |= GPS_BIT_SPEED;
    }
    if (gps.courseValid) {
      s.course = gps.courseDeg;
      s.gps_valid_mask |= GPS_BIT_COURSE;
    }
  }
  if (gps.satsValid) {
    s.sats = gps.sats;
    s.gps_valid_mask |= GPS_BIT_SATS;
  }
  if (gps.hdopValid) {
    s.hdop = gps.hdop;
    s.gps_valid_mask |= GPS_BIT_HDOP;
  }

  // Environment
  if (env.tempValid) {
    s.temp_c = env.tempC;
    s.env_valid_mask |= ENV_BIT_TEMP;
  }
  if (env.humValid) {
    s.humidity = env.humidity;
    s.env_valid_mask |= ENV_BIT_HUM;
  }
  if (env.presValid) {
    s.pressure_hpa = env.pressureHpa;
    s.env_valid_mask |= ENV_BIT_PRES;
  }
  if (env.gasValid) {
    s.gas_kohm = env.gasKohm;
    s.env_valid_mask |= ENV_BIT_GAS;
  }
  if (env.aqiValid) {
    s.aqi = env.aqi;
    s.aqi_source = env.aqiSource;
    s.env_valid_mask |= ENV_BIT_AQI;
  } else {
    s.aqi_source = AQI_NONE;
  }
  if (env.eco2Valid) {
    s.eco2_ppm = env.eco2Ppm;
    s.env_valid_mask |= ENV_BIT_ECO2;
  }
  if (env.tvocValid) {
    s.tvoc_ppb = env.tvocPpb;
    s.env_valid_mask |= ENV_BIT_TVOC;
  }

  // Sys
  s.rssi_valid = wifiConnected;
  s.rssi = wifiConnected ? rssi : 0;
  s.heap = ESP.getFreeHeap();
  s.cfg_version = cfg.version;

  return s;
}

void telemetryBufferPush(const TelemetrySample& sample) {
  if (!s_bufMutex) return;
  xSemaphoreTake(s_bufMutex, portMAX_DELAY);
  if (s_count == TELEMETRY_BUFFER_CAPACITY) {
    // Drop oldest sample
    s_head = (s_head + 1) % TELEMETRY_BUFFER_CAPACITY;
    --s_count;
    ++s_dropped;
  }
  size_t tail = (s_head + s_count) % TELEMETRY_BUFFER_CAPACITY;
  s_ring[tail] = sample;
  ++s_count;
  xSemaphoreGive(s_bufMutex);
}

size_t telemetryBufferCount() {
  if (!s_bufMutex) return 0;
  xSemaphoreTake(s_bufMutex, portMAX_DELAY);
  size_t c = s_count;
  xSemaphoreGive(s_bufMutex);
  return c;
}

size_t telemetryBufferCapacity() {
  return TELEMETRY_BUFFER_CAPACITY;
}

uint32_t telemetryBufferDroppedCount() {
  if (!s_bufMutex) return 0;
  xSemaphoreTake(s_bufMutex, portMAX_DELAY);
  uint32_t d = s_dropped;
  xSemaphoreGive(s_bufMutex);
  return d;
}

size_t telemetryBufferPeekBatch(TelemetrySample* out, size_t maxCount) {
  if (!s_bufMutex || !out || maxCount == 0) return 0;
  xSemaphoreTake(s_bufMutex, portMAX_DELAY);
  size_t n = min(s_count, maxCount);
  for (size_t i = 0; i < n; ++i) {
    out[i] = s_ring[(s_head + i) % TELEMETRY_BUFFER_CAPACITY];
  }
  xSemaphoreGive(s_bufMutex);
  return n;
}

void telemetryBufferPopCount(size_t count) {
  if (!s_bufMutex || count == 0) return;
  xSemaphoreTake(s_bufMutex, portMAX_DELAY);
  size_t toPop = min(count, s_count);
  s_head = (s_head + toPop) % TELEMETRY_BUFFER_CAPACITY;
  s_count -= toPop;
  xSemaphoreGive(s_bufMutex);
}

void telemetryBufferMarkReplay(size_t count) {
  if (!s_bufMutex || count == 0) return;
  xSemaphoreTake(s_bufMutex, portMAX_DELAY);
  size_t n = min(count, s_count);
  for (size_t i = 0; i < n; ++i) {
    s_ring[(s_head + i) % TELEMETRY_BUFFER_CAPACITY].replay = true;
  }
  xSemaphoreGive(s_bufMutex);
}

void telemetryFormatIsoUtc(int64_t epochMs, char* buf, size_t len) {
  time_t sec = static_cast<time_t>(epochMs / 1000LL);
  int64_t remMs = epochMs % 1000LL;
  if (remMs < 0) remMs += 1000LL;

  struct tm tmUtc;
  gmtime_r(&sec, &tmUtc);
  snprintf(buf, len, "%04d-%02d-%02dT%02d:%02d:%02d.%03uZ",
           tmUtc.tm_year + 1900,
           tmUtc.tm_mon + 1,
           tmUtc.tm_mday,
           tmUtc.tm_hour,
           tmUtc.tm_min,
           tmUtc.tm_sec,
           static_cast<unsigned>(remMs));
}

size_t telemetrySerializeSingle(const TelemetrySample& s, char* outBuf, size_t maxLen) {
  char devId[36];
  settingsGetDeviceId(devId, sizeof(devId));
  JsonDocument doc;
  populateJsonObject(s, doc.to<JsonObject>(), devId);
  return serializeJson(doc, outBuf, maxLen);
}

bool telemetrySerializeArray(const TelemetrySample* samples, size_t count, String& outJson) {
  if (!samples || count == 0) return false;
  char devId[36];
  settingsGetDeviceId(devId, sizeof(devId));
  JsonDocument doc;
  JsonArray arr = doc.to<JsonArray>();
  for (size_t i = 0; i < count; ++i) {
    populateJsonObject(samples[i], arr.add<JsonObject>(), devId);
  }
  outJson = "";
  outJson.reserve(count * 460);
  size_t written = serializeJson(doc, outJson);
  return written > 0;
}
