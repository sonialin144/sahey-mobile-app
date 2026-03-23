/**
 * Sahey — BLE contacts + NVS persistence
 *
 * Write char (app → ESP32): 12345678-1234-5678-1234-56789abcdef1
 *   Protocol: START:n, lines name|digits, END
 *
 * Read char (retrieve without Sahey app): 12345678-1234-5678-1234-56789abcdef2
 *   UTF-8 text: first line = count, then name|phone per line.
 *   Long lists may be truncated in GATT read; full blob is always in NVS.
 *
 * Flash: namespace "sahey", key "contacts" — survives power loss.
 * Your code can use `storedContacts` anywhere (e.g. GSM alert flow).
 */

#include <WiFi.h>
#include <Preferences.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <vector>

#if __has_include("USB.h")
#include "USB.h"
#define SAHEY_HAS_USB_H 1
#endif

static const char *SERVICE_UUID = "12345678-1234-5678-1234-56789abcdef0";
static const char *CHAR_WRITE_UUID = "12345678-1234-5678-1234-56789abcdef1";
static const char *CHAR_READ_UUID = "12345678-1234-5678-1234-56789abcdef2";
static const char *DEVICE_NAME = "Sahey";

static const char *PREF_NS = "sahey";
static const char *PREF_KEY = "contacts";

struct Contact {
  String name;
  String phone;
};

static std::vector<Contact> pendingContacts;
static std::vector<Contact> storedContacts;
static bool receiving = false;
static int expectedCount = 0;

static Preferences prefs;
static BLECharacteristic *gContactsReadChar = nullptr;

static String serializeContacts(const std::vector<Contact> &v) {
  String s = String((int)v.size());
  s += '\n';
  for (const auto &c : v) {
    s += c.name;
    s += '|';
    s += c.phone;
    s += '\n';
  }
  return s;
}

static void parseContactsBlob(const String &s, std::vector<Contact> &out) {
  out.clear();
  if (s.length() == 0) return;

  int pos = s.indexOf('\n');
  if (pos < 0) return;
  pos++;

  while (pos < (int)s.length()) {
    int nl = s.indexOf('\n', pos);
    if (nl < 0) nl = s.length();
    String line = s.substring(pos, nl);
    line.trim();
    if (line.length() > 0) {
      int sep = line.indexOf('|');
      if (sep > 0) {
        Contact c;
        c.name = line.substring(0, sep);
        c.phone = line.substring(sep + 1);
        out.push_back(c);
      }
    }
    pos = nl + 1;
  }
}

static void saveContactsToNvs(const std::vector<Contact> &v) {
  prefs.begin(PREF_NS, false);
  String blob = serializeContacts(v);
  prefs.putString(PREF_KEY, blob);
  prefs.end();
  Serial.printf(">>> NVS saved (%u bytes)\n", (unsigned)blob.length());
}

static void loadContactsFromNvs(std::vector<Contact> &v) {
  prefs.begin(PREF_NS, true);
  String blob = prefs.getString(PREF_KEY, "");
  prefs.end();
  if (blob.length() == 0) {
    Serial.println(">>> NVS: (empty — sync from app once)");
    v.clear();
    return;
  }
  parseContactsBlob(blob, v);
  Serial.printf(">>> NVS loaded %u contact(s)\n", (unsigned)v.size());
  if (v.size() > 0) {
    Serial.println(">>> NVS contents (verify):");
    for (size_t i = 0; i < v.size(); i++) {
      Serial.printf("    [%u] %s  ->  %s\n",
                    (unsigned)(i + 1),
                    v[i].name.c_str(),
                    v[i].phone.c_str());
    }
  }
}

static void updateReadCharacteristic() {
  if (!gContactsReadChar) return;
  String blob = serializeContacts(storedContacts);
  const size_t kMaxGatt = 500;
  if (blob.length() > kMaxGatt) {
    String shorty = blob.substring(0, kMaxGatt);
    shorty += "\n...[truncated; full in NVS]";
    gContactsReadChar->setValue(shorty.c_str());
  } else {
    gContactsReadChar->setValue(blob.c_str());
  }
}

class ContactCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *pChar) override {
    String value = pChar->getValue();
    if (value.length() == 0) return;

    Serial.print("[RX] ");
    Serial.println(value);

    if (value.startsWith("START:")) {
      pendingContacts.clear();
      expectedCount = value.substring(6).toInt();
      receiving = true;
      Serial.printf(">>> Expecting %d contact(s)\n", expectedCount);
      return;
    }

    if (value == "END") {
      receiving = false;
      storedContacts = pendingContacts;
      saveContactsToNvs(storedContacts);
      updateReadCharacteristic();

      Serial.printf(">>> Done. Committed %d contact(s) to RAM + NVS\n",
                    (int)storedContacts.size());
      for (size_t i = 0; i < storedContacts.size(); i++) {
        Serial.printf("    [%u] %s  ->  %s\n",
                      (unsigned)(i + 1),
                      storedContacts[i].name.c_str(),
                      storedContacts[i].phone.c_str());
      }
      return;
    }

    if (receiving) {
      int sep = value.indexOf('|');
      if (sep > 0) {
        Contact c;
        c.name = value.substring(0, sep);
        c.phone = value.substring(sep + 1);
        pendingContacts.push_back(c);
      }
    }
  }
};

static void configureAdvertising() {
  BLEAdvertising *adv = BLEDevice::getAdvertising();

  BLEAdvertisementData advData;
  advData.setFlags(0x06);
  advData.setName(DEVICE_NAME);
  adv->setAdvertisementData(advData);

  BLEAdvertisementData scanData;
  scanData.setCompleteServices(BLEUUID(SERVICE_UUID));
  scanData.setName(DEVICE_NAME);
  adv->setScanResponseData(scanData);

  adv->addServiceUUID(SERVICE_UUID);
  adv->setScanResponse(true);
  adv->setMinPreferred(0x06);
  BLEDevice::startAdvertising();
}

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer *s) override {
    (void)s;
    Serial.println(">>> Phone connected");
  }
  void onDisconnect(BLEServer *s) override {
    (void)s;
    Serial.println(">>> Phone disconnected — advertising again");
    configureAdvertising();
  }
};

void setup() {
#if defined(SAHEY_HAS_USB_H) && defined(ARDUINO_USB_CDC_ON_BOOT) && ARDUINO_USB_CDC_ON_BOOT
  USB.begin();
#endif

  Serial.begin(115200);
  delay(2000);
  Serial.println();
  Serial.println("=== Sahey ESP32 — contacts + NVS ===");

#ifdef LED_BUILTIN
  pinMode(LED_BUILTIN, OUTPUT);
#endif

  loadContactsFromNvs(storedContacts);

  WiFi.mode(WIFI_OFF);
  delay(200);

  BLEDevice::init(DEVICE_NAME);
  BLEServer *pServer = BLEDevice::createServer();
  pServer->setCallbacks(new ServerCallbacks());

  BLEService *pService = pServer->createService(SERVICE_UUID);

  BLECharacteristic *pWrite = pService->createCharacteristic(
      CHAR_WRITE_UUID,
      BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_WRITE |
          BLECharacteristic::PROPERTY_WRITE_NR);

  pWrite->setCallbacks(new ContactCallbacks());
  pWrite->setValue("");

  gContactsReadChar = pService->createCharacteristic(
      CHAR_READ_UUID,
      BLECharacteristic::PROPERTY_READ);
  updateReadCharacteristic();

  pService->start();
  configureAdvertising();

  Serial.printf("Advertising \"%s\". Read contacts: GATT %s (or use storedContacts in code).\n",
                DEVICE_NAME, CHAR_READ_UUID);
}

void loop() {
#ifdef LED_BUILTIN
  digitalWrite(LED_BUILTIN, (millis() / 500) % 2 ? HIGH : LOW);
#endif
  delay(200);
}
