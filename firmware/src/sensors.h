#pragma once

#include <Arduino.h>
#include "config.h"
#include "settings.h"

enum EnvChipType : uint8_t {
  ENV_NONE = 0,
  ENV_BME280 = 1,
  ENV_BME680 = 2
};

enum AqiSource : uint8_t {
  AQI_NONE = 0,
  AQI_BME680_IAQ = 1,
  AQI_ENS160 = 2
};

struct EnvReading {
  EnvChipType envChip = ENV_NONE;
  uint8_t envAddr = 0;
  bool hasEns160 = false;
  uint8_t ensAddr = 0;

  bool tempValid = false;
  float tempC = 0.0f;

  bool humValid = false;
  float humidity = 0.0f;

  bool presValid = false;
  float pressureHpa = 0.0f;

  bool baroAltValid = false;
  float baroAltM = 0.0f;

  bool gasValid = false;
  float gasKohm = 0.0f;

  bool aqiValid = false;
  int16_t aqi = 0;
  AqiSource aqiSource = AQI_NONE;

  bool eco2Valid = false;
  uint16_t eco2Ppm = 0;

  bool tvocValid = false;
  uint16_t tvocPpb = 0;

  bool bme680BurnInDone = false;
  uint8_t ensValidity = 3;
  float activeGasBaselineKohm = 0.0f;
};

void sensorsInit();
void sensorsUpdate(const DeviceConfig& cfg);
EnvReading sensorsGetReading();
size_t sensorsGetTempHistory(float* outBuf, size_t maxLen);
const char* sensorsSummaryString(char* buf, size_t len);
