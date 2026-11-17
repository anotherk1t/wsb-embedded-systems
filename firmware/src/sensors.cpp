#include "sensors.h"

#include <Adafruit_BME280.h>
#include <Adafruit_BME680.h>
#include <Wire.h>
#include <cmath>
#include "ens160.h"

namespace {

constexpr uint8_t BME_REG_CHIP_ID = 0xD0;
constexpr uint8_t CHIP_ID_BME280 = 0x60;
constexpr uint8_t CHIP_ID_BME680 = 0x61;

Adafruit_BME680 s_bme680(&Wire);
Adafruit_BME280 s_bme280;
Ens160Driver s_ens160;

EnvReading s_reading;

// BME680 async reading + IAQ baseline state
bool s_bme680Pending = false;
uint32_t s_sensorStartMs = 0;
uint32_t s_lastPollMs = 0;
float s_autoBaselineKohm = 0.0f;
bool s_hasAutoBaseline = false;

// Temperature history ring buffer for sparkline
float s_tempHist[TEMP_SPARKLINE_LEN];
size_t s_tempHistHead = 0;
size_t s_tempHistCount = 0;
uint32_t s_lastHistMs = 0;

bool readI2cReg8(uint8_t addr, uint8_t reg, uint8_t& val) {
  Wire.beginTransmission(addr);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) {
    return false;
  }
  if (Wire.requestFrom(static_cast<int>(addr), 1) != 1) {
    return false;
  }
  val = static_cast<uint8_t>(Wire.read());
  return true;
}

void pushTempHistory(float tempC) {
  s_tempHist[s_tempHistHead] = tempC;
  s_tempHistHead = (s_tempHistHead + 1) % TEMP_SPARKLINE_LEN;
  if (s_tempHistCount < TEMP_SPARKLINE_LEN) {
    ++s_tempHistCount;
  }
}

int16_t computeBme680Iaq(float gasKohm, float humidity, const DeviceConfig& cfg) {
  uint32_t elapsed = millis() - s_sensorStartMs;

  if (cfg.gas_baseline_kohm <= 0.0f) {
    if (elapsed < BME680_BURNIN_MS) {
      if (gasKohm > 0.5f) {
        if (!s_hasAutoBaseline) {
          s_autoBaselineKohm = gasKohm;
          s_hasAutoBaseline = true;
        } else {
          // Track upper burn-in stabilization smoothly without collapsing on short dips
          float alpha = (gasKohm > s_autoBaselineKohm) ? 0.20f : 0.03f;
          s_autoBaselineKohm = (1.0f - alpha) * s_autoBaselineKohm + alpha * gasKohm;
        }
      }
      s_reading.bme680BurnInDone = false;
    } else {
      if (!s_hasAutoBaseline && gasKohm > 0.5f) {
        s_autoBaselineKohm = gasKohm;
        s_hasAutoBaseline = true;
      }
      s_reading.bme680BurnInDone = true;
    }
  } else {
    s_reading.bme680BurnInDone = true;
  }

  float baseline = (cfg.gas_baseline_kohm > 0.0f) ? cfg.gas_baseline_kohm : s_autoBaselineKohm;
  if (baseline < 1.0f) baseline = 50.0f;
  s_reading.activeGasBaselineKohm = baseline;

  // Humidity score (25% weight, optimal at 38..42% RH)
  float humScore = 0.0f;
  float hum = constrain(humidity, 0.0f, 100.0f);
  if (hum >= 38.0f && hum <= 42.0f) {
    humScore = 25.0f;
  } else if (hum < 38.0f) {
    humScore = 25.0f * (hum / 38.0f);
  } else {
    humScore = 25.0f * ((100.0f - hum) / 58.0f);
  }

  // Gas score (75% weight, higher resistance = cleaner air)
  float ratio = constrain(gasKohm / baseline, 0.0f, 1.0f);
  float gasScore = 75.0f * ratio;

  float totalScore = constrain(humScore + gasScore, 0.0f, 100.0f);
  float iaq = (100.0f - totalScore) * 5.0f;
  return static_cast<int16_t>(lroundf(constrain(iaq, 0.0f, 500.0f)));
}

void applyEnvironmentalValues(float rawTempC, float rawHum, float rawPresHpa,
                              bool hasGas, float rawGasOhms, const DeviceConfig& cfg) {
  if (!std::isnan(rawTempC) && rawTempC > -60.0f && rawTempC < 120.0f) {
    s_reading.tempValid = true;
    s_reading.tempC = rawTempC + cfg.temp_offset_c;
  } else {
    s_reading.tempValid = false;
  }

  if (!std::isnan(rawHum) && rawHum >= 0.0f && rawHum <= 100.0f) {
    s_reading.humValid = true;
    s_reading.humidity = constrain(rawHum + cfg.humidity_offset, 0.0f, 100.0f);
  } else {
    s_reading.humValid = false;
  }

  if (!std::isnan(rawPresHpa) && rawPresHpa > 200.0f && rawPresHpa < 1300.0f) {
    s_reading.presValid = true;
    s_reading.pressureHpa = rawPresHpa + cfg.pressure_offset_hpa;
    if (cfg.sea_level_hpa > 0.0f) {
      s_reading.baroAltValid = true;
      s_reading.baroAltM = 44330.0f * (1.0f - powf(s_reading.pressureHpa / cfg.sea_level_hpa, 0.1903f));
    } else {
      s_reading.baroAltValid = false;
    }
  } else {
    s_reading.presValid = false;
    s_reading.baroAltValid = false;
  }

  if (hasGas && !std::isnan(rawGasOhms) && rawGasOhms > 0.0f) {
    s_reading.gasValid = true;
    s_reading.gasKohm = rawGasOhms / 1000.0f;
  } else {
    s_reading.gasValid = false;
  }

  // Record sparkline history immediately on first reading, then every SPARKLINE_INTERVAL_MS
  uint32_t now = millis();
  if (s_reading.tempValid && (s_tempHistCount == 0 || (now - s_lastHistMs) >= SPARKLINE_INTERVAL_MS)) {
    pushTempHistory(s_reading.tempC);
    s_lastHistMs = now;
  }
}

}  // namespace

void sensorsInit() {
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  Wire.setClock(I2C_FREQ_HZ);
  Wire.setTimeOut(50);

  s_reading = EnvReading{};
  s_sensorStartMs = millis();

  // Probe BME680 at 0x77 / 0x76 first
  const uint8_t bme680Addrs[2] = {0x77, 0x76};
  for (uint8_t addr : bme680Addrs) {
    uint8_t chipId = 0;
    if (readI2cReg8(addr, BME_REG_CHIP_ID, chipId) && chipId == CHIP_ID_BME680) {
      if (s_bme680.begin(addr)) {
        s_bme680.setTemperatureOversampling(BME680_OS_8X);
        s_bme680.setHumidityOversampling(BME680_OS_2X);
        s_bme680.setPressureOversampling(BME680_OS_4X);
        s_bme680.setIIRFilterSize(BME680_FILTER_SIZE_3);
        s_bme680.setGasHeater(320, 150);
        s_reading.envChip = ENV_BME680;
        s_reading.envAddr = addr;
        Serial.printf("[SENS] Detected BME680 at 0x%02X\n", addr);
        break;
      }
    }
  }

  // Else probe BME280 at 0x76 / 0x77
  if (s_reading.envChip == ENV_NONE) {
    const uint8_t bme280Addrs[2] = {0x76, 0x77};
    for (uint8_t addr : bme280Addrs) {
      uint8_t chipId = 0;
      if (readI2cReg8(addr, BME_REG_CHIP_ID, chipId) && chipId == CHIP_ID_BME280) {
        if (s_bme280.begin(addr, &Wire)) {
          s_bme280.setSampling(Adafruit_BME280::MODE_FORCED,
                               Adafruit_BME280::SAMPLING_X4,
                               Adafruit_BME280::SAMPLING_X4,
                               Adafruit_BME280::SAMPLING_X4,
                               Adafruit_BME280::FILTER_X4);
          s_reading.envChip = ENV_BME280;
          s_reading.envAddr = addr;
          Serial.printf("[SENS] Detected BME280 at 0x%02X\n", addr);
          break;
        }
      }
    }
  }

  if (s_reading.envChip == ENV_NONE) {
    Serial.println("[SENS] No BME680/BME280 detected on I2C");
  }

  // Probe optional ENS160 at 0x53 / 0x52
  const uint8_t ensAddrs[2] = {0x53, 0x52};
  for (uint8_t addr : ensAddrs) {
    if (s_ens160.begin(Wire, addr)) {
      s_reading.hasEns160 = true;
      s_reading.ensAddr = addr;
      Serial.printf("[SENS] Detected ENS160 at 0x%02X\n", addr);
      break;
    }
  }

  if (!s_reading.hasEns160) {
    Serial.println("[SENS] No ENS160 detected on I2C");
  }
}

void sensorsUpdate(const DeviceConfig& cfg) {
  uint32_t now = millis();

  // Handle non-blocking BME680 reading completion
  if (s_reading.envChip == ENV_BME680 && s_bme680Pending) {
    int rem = s_bme680.remainingReadingMillis();
    if (rem == Adafruit_BME680::reading_complete) {
      s_bme680Pending = false;
      if (s_bme680.endReading()) {
        applyEnvironmentalValues(s_bme680.temperature,
                                 s_bme680.humidity,
                                 s_bme680.pressure / 100.0f,
                                 true,
                                 static_cast<float>(s_bme680.gas_resistance),
                                 cfg);
      } else {
        Serial.println("[SENS] BME680 endReading failed");
      }
    } else if (rem == Adafruit_BME680::reading_not_started) {
      s_bme680Pending = false;
    }
  }

  if (s_lastPollMs != 0 && (now - s_lastPollMs) < SENSOR_POLL_MS) {
    return;
  }
  s_lastPollMs = now;

  if (s_reading.envChip == ENV_BME680) {
    if (!s_bme680Pending) {
      if (s_bme680.beginReading() == 0) {
        Serial.println("[SENS] BME680 beginReading failed");
      } else {
        s_bme680Pending = true;
      }
    }
  } else if (s_reading.envChip == ENV_BME280) {
    if (s_bme280.takeForcedMeasurement()) {
      applyEnvironmentalValues(s_bme280.readTemperature(),
                               s_bme280.readHumidity(),
                               s_bme280.readPressure() / 100.0f,
                               false, 0.0f, cfg);
    }
  }

  // Default AQI source to BME680 IAQ if available, then allow ENS160 to override
  if (s_reading.envChip == ENV_BME680 && s_reading.gasValid && s_reading.humValid) {
    s_reading.aqiValid = true;
    s_reading.aqi = computeBme680Iaq(s_reading.gasKohm, s_reading.humidity, cfg);
    s_reading.aqiSource = AQI_BME680_IAQ;
  } else if (!s_reading.hasEns160) {
    s_reading.aqiValid = false;
    s_reading.aqiSource = AQI_NONE;
  }

  if (s_reading.hasEns160) {
    if (s_reading.tempValid && s_reading.humValid) {
      s_ens160.setCompensation(s_reading.tempC, s_reading.humidity);
    }
    Ens160Reading ens;
    if (s_ens160.read(ens) && ens.valid) {
      s_reading.aqiValid = true;
      s_reading.aqi = ens.aqi500;
      s_reading.aqiSource = AQI_ENS160;
      s_reading.eco2Valid = true;
      s_reading.eco2Ppm = ens.eco2Ppm;
      s_reading.tvocValid = true;
      s_reading.tvocPpb = ens.tvocPpb;
      s_reading.ensValidity = ens.validity;
    } else {
      s_reading.ensValidity = ens.validity;
      s_reading.eco2Valid = false;
      s_reading.tvocValid = false;
      if (s_reading.envChip != ENV_BME680 || !s_reading.gasValid) {
        s_reading.aqiValid = false;
        s_reading.aqiSource = AQI_NONE;
      }
    }
  }
}

EnvReading sensorsGetReading() {
  return s_reading;
}

size_t sensorsGetTempHistory(float* outBuf, size_t maxLen) {
  if (!outBuf || maxLen == 0 || s_tempHistCount == 0) return 0;
  size_t count = min(s_tempHistCount, maxLen);
  size_t start = (s_tempHistHead + TEMP_SPARKLINE_LEN - count) % TEMP_SPARKLINE_LEN;
  for (size_t i = 0; i < count; ++i) {
    outBuf[i] = s_tempHist[(start + i) % TEMP_SPARKLINE_LEN];
  }
  return count;
}

const char* sensorsSummaryString(char* buf, size_t len) {
  const char* bmeStr = (s_reading.envChip == ENV_BME680) ? "BME680"
                     : (s_reading.envChip == ENV_BME280) ? "BME280"
                                                         : nullptr;
  if (bmeStr && s_reading.hasEns160) {
    snprintf(buf, len, "%s+ENS160", bmeStr);
  } else if (bmeStr) {
    snprintf(buf, len, "%s", bmeStr);
  } else if (s_reading.hasEns160) {
    snprintf(buf, len, "ENS160");
  } else {
    snprintf(buf, len, "None");
  }
  return buf;
}
