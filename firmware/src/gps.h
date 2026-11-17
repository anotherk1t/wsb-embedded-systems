#pragma once

#include <Arduino.h>

struct GpsReading {
  bool hasData = false;
  bool fix = false;

  bool latLonValid = false;
  double lat = 0.0;
  double lon = 0.0;

  bool altValid = false;
  float altM = 0.0f;

  bool speedValid = false;
  float speedKmh = 0.0f;

  bool courseValid = false;
  float courseDeg = 0.0f;

  bool satsValid = false;
  uint8_t sats = 0;

  bool hdopValid = false;
  float hdop = 0.0f;

  uint32_t fixAgeMs = UINT32_MAX;

  bool utcValid = false;
  int64_t utcEpochMs = 0;

  uint32_t charsProcessed = 0;
  uint32_t currentBaud = 9600;
};

void gpsInit(uint32_t baud);
void gpsSetBaud(uint32_t baud);
void gpsSetAssistedFix(double lat, double lon, float altM, uint8_t sats, float hdop);
void gpsUpdate();
GpsReading gpsGetReading();
