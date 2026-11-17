#include "ens160.h"

namespace {

constexpr uint8_t REG_PART_ID = 0x00;
constexpr uint8_t REG_OPMODE = 0x10;
constexpr uint8_t REG_TEMP_IN = 0x13;
constexpr uint8_t REG_RH_IN = 0x15;
constexpr uint8_t REG_DATA_STATUS = 0x20;
constexpr uint8_t REG_DATA_AQI = 0x21;

constexpr uint16_t ENS160_PART_ID = 0x0160;
constexpr uint8_t OPMODE_STANDARD = 0x02;
constexpr uint8_t OPMODE_RESET = 0xF0;

int16_t mapUbaToAqi500(uint8_t uba) {
  switch (uba) {
    case 1: return 25;
    case 2: return 75;
    case 3: return 150;
    case 4: return 250;
    case 5: return 400;
    default: return -1;
  }
}

}  // namespace

bool Ens160Driver::begin(TwoWire& wire, uint8_t addr) {
  _wire = &wire;
  _addr = addr;
  _detected = false;
  _hasCached = false;

  uint8_t idBuf[2] = {0, 0};
  if (!readRegs(REG_PART_ID, idBuf, 2)) {
    return false;
  }
  uint16_t partId = static_cast<uint16_t>(idBuf[0]) | (static_cast<uint16_t>(idBuf[1]) << 8);
  if (partId != ENS160_PART_ID) {
    return false;
  }

  // Soft-reset and enter standard sensing mode
  if (!writeReg8(REG_OPMODE, OPMODE_RESET)) {
    return false;
  }
  delay(15);

  if (!writeReg8(REG_OPMODE, OPMODE_STANDARD)) {
    return false;
  }
  delay(10);

  _detected = true;
  return true;
}

void Ens160Driver::setCompensation(float tempC, float rhPct) {
  if (!_detected) return;
  float clampedRh = constrain(rhPct, 0.0f, 100.0f);
  float kelvin = tempC + 273.15f;
  if (kelvin < 0.0f) kelvin = 0.0f;

  uint16_t tempIn = static_cast<uint16_t>(lroundf(kelvin * 64.0f));
  uint16_t rhIn = static_cast<uint16_t>(lroundf(clampedRh * 512.0f));

  writeReg16LE(REG_TEMP_IN, tempIn);
  writeReg16LE(REG_RH_IN, rhIn);
}

bool Ens160Driver::read(Ens160Reading& out) {
  if (!_detected) {
    out.valid = false;
    return false;
  }

  uint8_t status = 0;
  if (!readRegs(REG_DATA_STATUS, &status, 1)) {
    if (_hasCached && (millis() - _lastValidMs) < 10000UL) {
      out = _lastReading;
      return true;
    }
    out.valid = false;
    return false;
  }

  const bool errorFlag = (status & 0x40) != 0;
  const uint8_t validity = (status >> 2) & 0x03;
  const bool newData = (status & 0x02) != 0;

  if (errorFlag || validity == 3) {
    _lastReading.validity = validity;
    out.valid = false;
    out.validity = validity;
    return false;
  }

  if (newData) {
    // Burst read DATA_AQI (0x21), DATA_TVOC (0x22..0x23), DATA_ECO2 (0x24..0x25)
    uint8_t buf[5] = {0};
    if (readRegs(REG_DATA_AQI, buf, 5)) {
      uint8_t uba = buf[0] & 0x07;
      uint16_t tvoc = static_cast<uint16_t>(buf[1]) | (static_cast<uint16_t>(buf[2]) << 8);
      uint16_t eco2 = static_cast<uint16_t>(buf[3]) | (static_cast<uint16_t>(buf[4]) << 8);
      int16_t aqi500 = mapUbaToAqi500(uba);

      if (aqi500 >= 0) {
        _lastReading.valid = true;
        _lastReading.ubaAqi = uba;
        _lastReading.aqi500 = aqi500;
        _lastReading.tvocPpb = tvoc;
        _lastReading.eco2Ppm = eco2;
        _lastReading.validity = validity;
        _hasCached = true;
        _lastValidMs = millis();
      }
    }
  }

  if (_hasCached && (millis() - _lastValidMs) < 15000UL) {
    out = _lastReading;
    return true;
  }

  out.valid = false;
  out.validity = validity;
  return false;
}

bool Ens160Driver::writeReg8(uint8_t reg, uint8_t val) {
  if (!_wire) return false;
  _wire->beginTransmission(_addr);
  _wire->write(reg);
  _wire->write(val);
  return _wire->endTransmission() == 0;
}

bool Ens160Driver::writeReg16LE(uint8_t reg, uint16_t val) {
  if (!_wire) return false;
  _wire->beginTransmission(_addr);
  _wire->write(reg);
  _wire->write(static_cast<uint8_t>(val & 0xFF));
  _wire->write(static_cast<uint8_t>((val >> 8) & 0xFF));
  return _wire->endTransmission() == 0;
}

bool Ens160Driver::readRegs(uint8_t reg, uint8_t* buf, size_t len) {
  if (!_wire) return false;
  _wire->beginTransmission(_addr);
  _wire->write(reg);
  if (_wire->endTransmission(false) != 0) {
    return false;
  }
  size_t got = _wire->requestFrom(static_cast<int>(_addr), static_cast<int>(len));
  if (got != len) {
    while (_wire->available()) {
      (void)_wire->read();
    }
    return false;
  }
  for (size_t i = 0; i < len; ++i) {
    buf[i] = static_cast<uint8_t>(_wire->read());
  }
  return true;
}
