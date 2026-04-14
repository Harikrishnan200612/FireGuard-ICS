#include <WiFi.h>
#include <HTTPClient.h>
#include <DHT.h>

// ===== WIFI =====
const char* ssid = "1234";
const char* password = "12341234";

// ===== SERVER =====
// IMPORTANT: Replace this IP with your computer's current IP address!
const char* serverURL = "http://10.39.91.17:3002/api/trigger-alert";

// ===== PINS =====
#define DHTPIN 4
#define DHTTYPE DHT11
#define MQ2 34
#define FAN 26
#define PUMP 27
#define BUZZER 25

DHT dht(DHTPIN, DHTTYPE);

// ===== THRESHOLDS =====
#define TEMP_WARN 40
#define TEMP_FIRE 55
#define SMOKE_WARN 4000
#define SMOKE_FIRE 4050

// ===== FILTER =====
float smokeFiltered = 0;
float alpha = 0.2;

// ===== VARIABLES =====
float temperature = 0;
float humidity = 0;
int smoke = 0;
int level = 0;

// ===== WIFI CONNECT =====
void connectWiFi() {
  Serial.print("Connecting to WiFi");
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\n✅ WiFi Connected");
  Serial.print("IP: ");
  Serial.println(WiFi.localIP());
}

// ===== READ SENSORS =====
void readSensors() {
  // ---- DHT11 ----
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  if (!isnan(t) && !isnan(h)) {
    temperature = t;
    humidity = h;
  }

  // ---- MQ2 FILTER ----
  int rawSmoke = analogRead(MQ2);
  smokeFiltered = alpha * rawSmoke + (1 - alpha) * smokeFiltered;
  smoke = (int)smokeFiltered;
}

// ===== CONTROL OUTPUT =====
void controlSystem() {
  // FIRE
  if (temperature >= TEMP_FIRE || smoke >= SMOKE_FIRE) {
    level = 2;
    digitalWrite(FAN, LOW);
    digitalWrite(PUMP, LOW);
    Serial.println("🔥 FIRE DETECTED");
    digitalWrite(BUZZER, HIGH);
    delay(100);
    digitalWrite(BUZZER, LOW);
    delay(100);
  }
  // WARNING
  else if (temperature >= TEMP_WARN || smoke >= SMOKE_WARN) {
    level = 1;
    digitalWrite(FAN, LOW);
    digitalWrite(PUMP, HIGH);
    Serial.println("⚠ WARNING");
    digitalWrite(BUZZER, HIGH);
    delay(400);
    digitalWrite(BUZZER, LOW);
    delay(400);
  }
  // SAFE
  else {
    level = 0;
    digitalWrite(FAN, HIGH);
    digitalWrite(PUMP, HIGH);
    digitalWrite(BUZZER, LOW);
    Serial.println("✅ SAFE");
  }
}

// ===== SEND DATA =====
void sendToServer() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("⚠ WiFi reconnecting...");
    connectWiFi();
    return;
  }

  HTTPClient http;
  WiFiClient client;

  if (http.begin(client, serverURL)) {
    http.addHeader("Content-Type", "application/json");

    String json = "{";
    json += "\"zone\":\"D\",";
    json += "\"temp\":" + String(temperature) + ",";
    json += "\"smoke\":" + String(smoke) + ",";
    json += "\"humidity\":" + String(humidity) + ",";
    json += "\"level\":" + String(level);
    json += "}";

    int response = http.POST(json);

    Serial.print("📡 Server Response: ");
    Serial.println(response);

    if (response == -1) {
      Serial.println("❌ CONNECTION FAILED: Check Server IP & Firewall");
    }

    http.end();
  } else {
    Serial.println("❌ HTTP setup failed");
  }
}

// ===== SETUP =====
void setup() {
  Serial.begin(115200);
  pinMode(FAN, OUTPUT);
  pinMode(PUMP, OUTPUT);
  pinMode(BUZZER, OUTPUT);
  digitalWrite(FAN, HIGH);
  digitalWrite(PUMP, HIGH);
  digitalWrite(BUZZER, LOW);
  dht.begin();
  connectWiFi();
}

// ===== LOOP =====
void loop() {
  readSensors();
  Serial.print("🌡 Temp: ");
  Serial.print(temperature);
  Serial.print(" °C | 💧 Humidity: ");
  Serial.print(humidity);
  Serial.print(" % | 💨 Smoke: ");
  Serial.println(smoke);
  controlSystem();
  sendToServer();
  Serial.println("---------------------");
  delay(2000);
}
