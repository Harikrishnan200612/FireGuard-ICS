# FireGuard ICS v2.0
## Industrial Fire Monitoring and Automated Response System
### Technical Documentation & Engineering Report

---

## 1. Executive Summary

FireGuard ICS is a microcontroller-based industrial fire monitoring and automated response system designed for real-time detection, classification, and suppression of fire events in multi-zone facilities. Built on the ESP32 microcontroller platform with MQ-2 smoke sensing and NTC temperature measurement, the system implements a three-level alert hierarchy, automated actuator control via relay-driven exhaust fan and water pump, and multi-channel remote alerting through Telegram and SMS APIs.

This document covers system architecture, firmware design, fail-safe mechanisms, alert logic, dashboard interface, and deployment considerations suitable for final-year engineering project evaluation.

---

## 2. System Architecture

### 2.1 Module Overview

The system is organised into four functional modules, each with a clearly defined scope and interface:

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  SENSING        │───▶│  PROCESSING      │───▶│  RESPONSE       │───▶│  ALERTING       │
│                 │    │                  │    │                 │    │                 │
│ · MQ-2 Smoke    │    │ · Moving Average │    │ · Exhaust Fan   │    │ · Dashboard     │
│ · NTC Temp      │    │ · Threshold Eval │    │ · Water Pump    │    │ · Telegram Bot  │
│ · 12-bit ADC    │    │ · Fault Detection│    │ · Active Buzzer │    │ · Twilio SMS    │
│ · 1000 ms poll  │    │ · Alert Classify │    │ · Status LED    │    │ · HTTP JSON API │
└─────────────────┘    └──────────────────┘    └─────────────────┘    └─────────────────┘
```

### 2.2 Hardware Specification

| Component | Specification | Purpose |
|---|---|---|
| ESP32 DevKit v1 | Dual-core 240 MHz, WiFi 802.11 b/g/n | Central controller, HTTP server, WiFi comms |
| MQ-2 Smoke Sensor | Analog output, 12-bit ADC (0–4095) | Smoke and combustible gas detection |
| NTC Thermistor | 10 kΩ, B=3950, pull-up 10 kΩ | Ambient temperature measurement |
| Relay Module | 2-channel, Active-Low, 5V | Controls exhaust fan and water pump |
| Active Buzzer | 3.3 V compatible | Audible alert tone |
| Li-Ion Battery | 3.7 V / TP4056 charger | Portable standalone power |

### 2.3 Pin Assignment

| GPIO | Function | Type |
|---|---|---|
| GPIO 34 | MQ-2 Analog Output | ADC Input |
| GPIO 35 | NTC Thermistor | ADC Input |
| GPIO 26 | Relay 1 — Exhaust Fan | Digital Output |
| GPIO 27 | Relay 2 — Water Pump | Digital Output |
| GPIO 25 | Active Buzzer | Digital Output |
| GPIO 2  | Status LED (built-in) | Digital Output |

---

## 3. System Workflow

### 3.1 Normal Operation Cycle (1000 ms)

```
Sensor Read → Smoothing (5-sample average) → Threshold Evaluation → Actuator Decision → HTTP Response
     │                   │                          │                      │
  MQ-2 ADC          Noise rejection           Level 0/1/2           Fan / Pump / Buzzer
  NTC ADC           Fault detection           Classification        Relay state update
```

### 3.2 Alert Level Classification

| Level | Condition | Fan | Pump | Buzzer | Dashboard |
|---|---|---|---|---|---|
| 0 — NOMINAL | Temp < 40°C AND Smoke < 2800 | OFF | OFF | OFF | Green indicator |
| 1 — WARNING | Temp ≥ 40°C OR Smoke ≥ 2800 | ON  | OFF | Slow beep (1 Hz) | Yellow indicator |
| 2 — CRITICAL | Temp ≥ 55°C OR Smoke ≥ 3200 | ON  | ON  | Rapid beep (5 Hz) | Red + Telegram/SMS |

### 3.3 Decision Logic (OR Condition)

Either sensor breaching its threshold independently triggers the corresponding alert level. This conservative design ensures no event goes undetected even if one sensor degrades. The logical expression is:

```
level_2 = (temperature ≥ TH_TEMP_CRIT) OR (smoke_adc ≥ TH_SMOKE_CRIT)
level_1 = (temperature ≥ TH_TEMP_WARN) OR (smoke_adc ≥ TH_SMOKE_WARN)  [and NOT level_2]
```

### 3.4 Data Flow Diagram

```
ESP32 (Zone D)
    │
    ├─── /data  (GET, every 2s) ────▶ FireGuard Dashboard (Browser)
    │                                        │
    ├─── /control (POST) ◀──────────────────┤ Manual override commands
    │                                        │
    └─── /health (GET) ◀────────────────────┘ Connectivity check

Dashboard
    │
    └─── /api/trigger-alert (POST) ────▶ Node.js Backend Server
                                                │
                                    ┌───────────┴───────────┐
                                    ▼                       ▼
                              Telegram Bot API         Twilio SMS API
                              (api.telegram.org)       (api.twilio.com)
```

---

## 4. Firmware Design

### 4.1 Sensor Signal Conditioning

Raw ADC readings from the MQ-2 sensor contain high-frequency noise due to supply fluctuations and ADC quantisation. A five-sample circular moving-average filter is implemented in firmware:

```
smoothed_value = (reading[t] + reading[t-1] + ... + reading[t-4]) / 5
```

This provides an effective noise rejection of approximately 6 dB while maintaining a detection latency of only 5 seconds at the 1 Hz sample rate — well within acceptable fire detection response times (typically <30 seconds per IS 2189).

### 4.2 Temperature Conversion (Steinhart-Hart)

The NTC thermistor's resistance is converted to temperature using the simplified Steinhart-Hart (Beta) equation:

```
1/T = 1/T_nominal + (1/B) × ln(R / R_nominal)
```

Where T_nominal = 298.15 K (25°C), B = 3950, and R is calculated from the measured ADC voltage divider output.

### 4.3 Fail-Safe Mechanisms

| Mechanism | Implementation | Purpose |
|---|---|---|
| Hardware Watchdog (WDT) | `esp_task_wdt`, 8-second timeout | Reboots ESP32 on firmware hang |
| Active-Low Relays | HIGH = relay OFF (de-energised) | Power loss → actuators de-energise (safe default) |
| Sensor Fault Detection | 3 consecutive out-of-range reads → FAULT flag | Detects sensor disconnect or short circuit |
| WiFi Auto-Reconnect | 10-second reconnect interval | Standalone actuation continues if WiFi drops |
| EEPROM Threshold Persistence | Survives power cycle | Configuration retained across restarts |
| Sensor Fault Escalation | Fault → Level 2 (Critical) | No undetected failures in sensing layer |

### 4.4 Manual Override Protocol

The dashboard may issue manual override commands via POST `/control`:

- `fanOverride: true, fanState: true/false` — manual fan control
- `pumpOverride: true, pumpState: true/false` — manual pump control
- POST `/reset` — clears all overrides, restores automatic control

All overrides are logged. The ESP32 resumes automatic actuation immediately upon override release.

---

## 5. HTTP API Reference

### GET /data
Returns current sensor readings, actuator states, and device metadata in JSON format.

```json
{
  "device": "FG-ESP32-D001",
  "zone": "D",
  "fw": "2.0.0",
  "temperature": 32.4,
  "smoke": 2785,
  "alertLevel": 0,
  "fanOn": false,
  "pumpOn": false,
  "buzzerOn": false,
  "sensorFault": false,
  "uptime": 3600,
  "reads": 3601,
  "wifiRSSI": -62,
  "thresholds": {
    "tempWarn": 40, "tempCrit": 55,
    "smokeWarn": 2800, "smokeCrit": 3200
  }
}
```

### POST /control
Accepts JSON commands for manual override or threshold update.

### GET /health
Lightweight ping endpoint. Returns `{"status":"online","uptime":N}`.

### POST /reset
Clears all manual overrides. Restores automatic control mode.

---

## 6. Dashboard Interface

### 6.1 Role-Based Access Control

| Role | Credentials | Capabilities |
|---|---|---|
| Administrator | admin / admin123 | Full access: simulation, dispatch, config, manual controls |
| Supervisor | sup / sup123 | Analytics, task management, dispatch |
| Operator | user / user123 | Field tasks, zone monitoring (read-only controls) |

### 6.2 Dashboard Modules

**Dashboard** — KPI summary (fire/warning/safe zone counts), live sensor bars with threshold markers, actuator status, activity log with severity classification.

**Zone Map** — Interactive SVG floor plan with 5 monitored zones. Zone fill colour encodes alert status (green/amber/red). Fan and pump status overlaid on their respective zones. Animated personnel dots show occupancy; dots turn blue during evacuation and trace exit waypoints.

**Live Sensors** — Large-format readouts of temperature and smoke ADC with colour-coded status bars. ESP32 uptime, WiFi RSSI, and sensor fault indicator shown when hardware is connected.

**Analytics** — Time-series charts for temperature, smoke ADC, and combined parameter view using Chart.js. Up to 30 data points retained.

**Evacuation** — Per-zone evacuation status with route display. Administrator can trigger or clear full facility evacuation. Personnel dots animate toward exits.

**Field Tasks** — Step-by-step maintenance tasks with progress tracking across roles.

**Devices** — Fan, pump, and sensor inventory with status indicators and battery levels.

**Settings** — Threshold sliders with ESP32 push capability, emergency contacts (Telegram, SMS), and zone IP configuration.

### 6.3 Guardian AI Chatbot

An on-screen assistant responds to natural-language queries about zone status, sensor readings, evacuation routes, and system procedures. No external API is required; responses are generated locally from live system state.

---

## 7. Alert and Notification System

### 7.1 Telegram Integration

On Level 2 detection, the Node.js backend posts a structured HTML-formatted message to the configured Telegram bot. The message includes zone ID, temperature, smoke ADC, timestamp, facility address, and suppression status.

### 7.2 Twilio SMS (Optional)

If Twilio credentials are provided in `.env`, SMS notifications are dispatched to the configured contacts (owner, police, ambulance, fire services). The same information as the Telegram message is delivered in plain text.

### 7.3 Alert Suppression

Once an alert is dispatched, a `dispatchFired` flag prevents duplicate notifications for the same fire event. The flag resets automatically when all zones return to nominal status.

---

## 8. Redundancy and Security Considerations

### 8.1 Redundancy
- **Sensor redundancy**: Temperature and smoke readings are evaluated independently; either sensor alone is sufficient to trigger actuation. This provides inherent redundancy — a failing smoke sensor does not prevent temperature-based detection.
- **Standalone operation**: If WiFi or the backend server is unavailable, the ESP32 continues local actuation (fan, pump, buzzer) based on its own sensor readings. Remote alerting is the only degraded capability.
- **Simulation mode**: The dashboard operates entirely without hardware, allowing testing and demonstration with simulated sensor data.

### 8.2 Security Considerations
- The HTTP API is designed for LAN use only; it should not be exposed to the internet without authentication middleware.
- CORS is enabled for local development; in production, restrict origins to the dashboard's IP.
- Telegram bot tokens and Twilio credentials are stored in `.env` and never committed to source control.
- Dashboard credentials are stored as JavaScript constants for demonstration; in production these should be validated server-side.

---

## 9. Bill of Materials

| Component | Qty | Unit Cost (approx.) | Total |
|---|---|---|---|
| ESP32 DevKit v1 | 1 | ₹350 | ₹350 |
| MQ-2 Smoke Sensor | 1 | ₹150 | ₹150 |
| NTC Thermistor 10kΩ | 1 | ₹20 | ₹20 |
| 2-Channel Relay Module | 1 | ₹120 | ₹120 |
| Active Buzzer | 1 | ₹25 | ₹25 |
| 10kΩ Resistor (pull-up) | 1 | ₹2 | ₹2 |
| Li-Ion 3.7V Cell | 1 | ₹200 | ₹200 |
| TP4056 Charger Module | 1 | ₹40 | ₹40 |
| Breadboard + Jumpers | 1 | ₹80 | ₹80 |
| **Total** | | | **₹987** |

---

## 10. Future Enhancements (Realistic)

- **Multiple ESP32 nodes**: Assign one ESP32 per zone for true distributed sensing. The dashboard already supports multi-zone IP configuration.
- **DHT22 humidity sensor**: Replace NTC with DHT22 for both temperature and humidity on a single digital GPIO.
- **MQTT broker**: Replace HTTP polling with MQTT pub/sub for lower latency and reduced network overhead.
- **Raspberry Pi gateway**: Run the Node.js backend on a local Raspberry Pi for offline-capable alerting without internet.
- **OTA firmware update**: Use ESP32's built-in OTA capability to update firmware from the dashboard without physical access.
- **Battery voltage monitoring**: Add ADC-based battery voltage readout to the `/data` endpoint for power management awareness.

---

## 11. Setup Instructions

### 11.1 ESP32 Firmware
1. Install Arduino IDE and add ESP32 board support.
2. Install libraries via Library Manager: **ArduinoJson**, **esp_task_wdt** (built-in).
3. Open `fireguard_esp32.ino`.
4. Set `WIFI_SSID` and `WIFI_PASSWORD` at the top of the file.
5. Flash to ESP32. Open Serial Monitor at 115200 baud to observe output.
6. Note the IP address printed on successful WiFi connection.

### 11.2 Backend Server
```bash
npm install
cp _env .env          # Edit .env to add Twilio credentials if available
node server.js        # Or: npm start
```
Dashboard available at http://localhost:3000

### 11.3 Connecting Hardware
1. Log in to the dashboard (admin/admin123).
2. Navigate to Settings → ESP32 Zone Devices.
3. Enter the ESP32's IP address in the Zone D row.
4. Click "Connect Devices".
5. Zone D status indicator turns green; real sensor data begins streaming.

---

*FireGuard ICS v2.0 — Designed for Final Year Engineering Project, 2025*
*Department of Electronics and Communication Engineering / Computer Science Engineering*
