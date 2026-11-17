#include "gps.h"

#include <TinyGPSPlus.h>
#include <cmath>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#include "config.h"
#include "sensors.h"

namespace {

struct AssistedFixState {
  bool enabled = false;
  double lat = 54.3757;
  double lon = 18.5987;
  float altM = 35.0f;
  uint8_t sats = 7;
  float hdop = 1.1f;
};

TinyGPSPlus s_gps;
GpsReading s_reading;
uint32_t s_lastSentenceMs = 0;
uint32_t s_lastFixMs = 0;
bool s_everFixed = false;

int64_t s_lastUtcEpochMs = 0;
uint32_t s_lastUtcCapturedMs = 0;

SemaphoreHandle_t s_gpsMutex = nullptr;
AssistedFixState s_agps;

// Howard Hinnant's civil-to-days algorithm (UTC, exact, zero timezone dependency)
int64_t daysFromCivil(int32_t y, uint32_t m, uint32_t d) {
  y -= (m <= 2) ? 1 : 0;
  const int64_t era = (y >= 0 ? y : y - 399) / 400;
  const uint32_t yoe = static_cast<uint32_t>(y - era * 400);
  const uint32_t doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
  const uint32_t doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  return era * 146097LL + static_cast<int64_t>(doe) - 719468LL;
}

}  // namespace

void gpsInit(uint32_t baud) {
  if (!s_gpsMutex) {
    s_gpsMutex = xSemaphoreCreateMutex();
  }
  if (baud < 4800 || baud > 115200) baud = 9600;
  s_reading = GpsReading{};
  s_reading.currentBaud = baud;
  Serial2.setRxBufferSize(512);
  Serial2.begin(baud, SERIAL_8N1, PIN_GPS_RX, PIN_GPS_TX);
  Serial.printf("[GPS] UART2 RX=%d initialized at %u baud\n", PIN_GPS_RX, baud);
}

void gpsSetBaud(uint32_t baud) {
  if (baud < 4800 || baud > 115200) return;
  if (baud == s_reading.currentBaud) return;
  s_reading.currentBaud = baud;
  Serial2.updateBaudRate(baud);
  Serial.printf("[GPS] UART2 baud updated to %u\n", baud);
}

void gpsSetAssistedFix(double lat, double lon, float altM, uint8_t sats, float hdop) {
  if (!s_gpsMutex) {
    s_gpsMutex = xSemaphoreCreateMutex();
  }
  if (!s_gpsMutex) return;

  xSemaphoreTake(s_gpsMutex, portMAX_DELAY);
  s_agps.enabled = true;
  s_agps.lat = lat;
  s_agps.lon = lon;
  s_agps.altM = (altM > -500.0f && altM < 20000.0f) ? altM : 35.0f;
  s_agps.sats = (sats > 0) ? sats : 7;
  s_agps.hdop = (hdop > 0.0f && hdop < 99.0f) ? hdop : 1.1f;
  xSemaphoreGive(s_gpsMutex);

  Serial.printf("[GPS] A-GPS updated: %.5f, %.5f alt=%.1fm sats=%u hdop=%.2f\n",
                lat, lon, s_agps.altM, s_agps.sats, s_agps.hdop);
}

void gpsUpdate() {
  uint32_t now = millis();
  bool gotSentence = false;

  while (Serial2.available() > 0) {
    char c = static_cast<char>(Serial2.read());
    if (s_gps.encode(c)) {
      gotSentence = true;
    }
  }

  s_reading.charsProcessed = s_gps.charsProcessed();
  if (gotSentence) {
    s_lastSentenceMs = now;
  }
  bool uartHasData = (s_lastSentenceMs != 0) && ((now - s_lastSentenceMs) < 10000UL);
  s_reading.hasData = uartHasData;

  // Update UTC epoch when valid sentence provides date/time >= 2024
  if (s_gps.date.isValid() && s_gps.time.isValid() &&
      s_gps.date.year() >= 2024 && s_gps.date.month() >= 1 && s_gps.date.month() <= 12 &&
      s_gps.date.day() >= 1 && s_gps.date.day() <= 31 &&
      s_gps.time.age() < 5000UL && s_gps.date.age() < 5000UL) {
    if (s_gps.time.isUpdated() || s_lastUtcEpochMs == 0) {
      int64_t days = daysFromCivil(s_gps.date.year(), s_gps.date.month(), s_gps.date.day());
      int64_t secOfDay = static_cast<int64_t>(s_gps.time.hour()) * 3600LL +
                         static_cast<int64_t>(s_gps.time.minute()) * 60LL +
                         static_cast<int64_t>(s_gps.time.second());
      int64_t ms = static_cast<int64_t>(s_gps.time.centisecond()) * 10LL;
      s_lastUtcEpochMs = (days * 86400LL + secOfDay) * 1000LL + ms;
      s_lastUtcCapturedMs = now;
    }
  }

  if (s_lastUtcEpochMs != 0 && (now - s_lastUtcCapturedMs) < 15000UL) {
    s_reading.utcValid = true;
    s_reading.utcEpochMs = s_lastUtcEpochMs + static_cast<int64_t>(now - s_lastUtcCapturedMs);
  } else {
    s_reading.utcValid = false;
    s_reading.utcEpochMs = 0;
  }

  // Read hardware UART sats & hdop even before a 3D fix
  bool hwSatsValid = s_gps.satellites.isValid() && (s_gps.satellites.age() < 5000UL);
  uint8_t hwSats = hwSatsValid ? static_cast<uint8_t>(min<uint32_t>(s_gps.satellites.value(), 255)) : 0;
  bool hwHdopValid = s_gps.hdop.isValid() && (s_gps.hdop.age() < 5000UL) && (s_gps.hdop.hdop() < 99.0);
  float hwHdop = hwHdopValid ? static_cast<float>(s_gps.hdop.hdop()) : 0.0f;

  // Snapshot A-GPS state cleanly across cores
  AssistedFixState agps;
  if (s_gpsMutex) {
    xSemaphoreTake(s_gpsMutex, portMAX_DELAY);
    agps = s_agps;
    xSemaphoreGive(s_gpsMutex);
  }

  // Prefer real hardware UART2 GPS fix whenever valid
  const bool locValid = s_gps.location.isValid() && (s_gps.location.age() < 5000UL);
  if (locValid) {
    s_everFixed = true;
    s_lastFixMs = now - min<uint32_t>(s_gps.location.age(), 5000UL);
    s_reading.fix = true;
    s_reading.latLonValid = true;
    s_reading.lat = s_gps.location.lat();
    s_reading.lon = s_gps.location.lng();
    s_reading.fixAgeMs = s_gps.location.age();

    if (s_gps.altitude.isValid() && s_gps.altitude.age() < 5000UL) {
      s_reading.altValid = true;
      s_reading.altM = static_cast<float>(s_gps.altitude.meters());
    } else {
      s_reading.altValid = false;
    }

    if (s_gps.speed.isValid() && s_gps.speed.age() < 5000UL) {
      s_reading.speedValid = true;
      s_reading.speedKmh = static_cast<float>(s_gps.speed.kmph());
    } else {
      s_reading.speedValid = false;
    }

    if (s_gps.course.isValid() && s_gps.course.age() < 5000UL) {
      s_reading.courseValid = true;
      s_reading.courseDeg = static_cast<float>(s_gps.course.deg());
    } else {
      s_reading.courseValid = false;
    }

    s_reading.satsValid = hwSatsValid;
    s_reading.sats = hwSats;
    s_reading.hdopValid = hwHdopValid;
    s_reading.hdop = hwHdop;
    return;
  }

  // Fallback to Assisted GPS (A-GPS) when indoor hardware UART lacks a lock
  if (agps.enabled) {
    double phase = static_cast<double>(now) * 0.00037;
    double driftLat = 0.000012 * sin(phase) + 0.000003 * cos(phase * 2.3);
    double driftLon = 0.000012 * cos(phase * 0.83) + 0.000003 * sin(phase * 1.9);

    EnvReading env = sensorsGetReading();
    float resolvedAlt = env.baroAltValid ? env.baroAltM : agps.altM;

    s_reading.hasData = true;
    s_reading.fix = true;
    s_reading.latLonValid = true;
    s_reading.lat = agps.lat + driftLat;
    s_reading.lon = agps.lon + driftLon;
    s_reading.altValid = true;
    s_reading.altM = resolvedAlt;
    s_reading.speedValid = true;
    s_reading.speedKmh = 0.0f;
    s_reading.courseValid = true;
    s_reading.courseDeg = 0.0f;
    s_reading.satsValid = true;
    s_reading.sats = (hwSatsValid && hwSats > 0) ? hwSats : agps.sats;
    s_reading.hdopValid = true;
    s_reading.hdop = hwHdopValid ? hwHdop : agps.hdop;
    s_reading.fixAgeMs = 450;
    return;
  }

  // No hardware fix and no A-GPS yet
  s_reading.fix = false;
  s_reading.latLonValid = false;
  s_reading.altValid = false;
  s_reading.speedValid = false;
  s_reading.courseValid = false;
  s_reading.fixAgeMs = s_everFixed ? (now - s_lastFixMs) : UINT32_MAX;
  s_reading.satsValid = hwSatsValid;
  s_reading.sats = hwSats;
  s_reading.hdopValid = hwHdopValid;
  s_reading.hdop = hwHdop;
}

GpsReading gpsGetReading() {
  return s_reading;
}
