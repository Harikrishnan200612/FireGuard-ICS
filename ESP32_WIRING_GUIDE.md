# FireGuard ICS & ESP32 Hardware Integration

## 🔌 1. Wiring Connections
To connect the physical components to your ESP32, use the following pin mappings strictly matching `fireguard_esp32.ino`:

| Component | ESP32 Pin | Important Wiring Details |
| :--- | :--- | :--- |
| **MQ-2 Gas/Smoke Sensor** | **34** (Analog) | Connect MQ-2 `A0` to GPIO 34. Since MQ-2 outputs 5V logic on analog out, **use a voltage divider** (e.g., 20k / 10k) to step down the max voltage to 3.3V for safe ESP32 input. |
| **NTC Thermistor Module** | **35** (Analog) | Connect Analog out to GPIO 35. Make sure the reference voltage matches 3.3V. |
| **Exhaust Fan Relay** | **26** (Digital) | Connect to the `IN` or `SIG` pin of a 5V/Relay module. **Caution:** Do not draw fan power directly from ESP32 pins. Use a separate power source for the fan. |
| **Water Pump Relay** | **27** (Digital) | Connect to the `IN` or `SIG` pin of a 5V Relay module. |
| **Alarm Buzzer** | **25** (Digital) | Use an active buzzer. Ensure you use a transistor or relay if the buzzer draws more than 20mA. |

* **Power Note:** Power the ESP32 using the USB port or supply a stable 5V source to the `VIN` or `5V` pin. Ensure all sensors and relays share a common `GND` with the ESP32.

---

## 🛠 2. Flashing the Full Arduino Code
I have embedded the complete industrial-grade hardware code into your folder as **`fireguard_esp32.ino`**.

1. Open **Arduino IDE**.
2. Make sure you have installed the **ESP32 Board Package** (via Board Manager).
3. Connect your board and select: `Tools` > `Board` > `DOIT ESP32 DEVKIT V1` (or your equivalent).
4. Go to `Sketch` > `Include Library` > `Manage Libraries` and install **`ArduinoJson`** (by Benoit Blanchon).
5. Open `fireguard_esp32.ino` and update line 8 and 9 with your actual Wi-Fi SSID and Password.
6. Click **Upload**.
7. Open the Arduino Serial Monitor (baud rate **115200**) to verify initialization.
8. Grab the **Local IP Address** printed on the monitor.

---

## 🌐 3. Linking Hardware to Dashboard
1. Go to your FireGuard ICS Dashboard in the browser (`http://localhost:3000`).
2. Login as the **Administrator** (`admin` / `admin123`).
3. Open the **Settings** menu.
4. Scroll down to **Hardware Devices / ESP32 Configuration**.
5. Input the IP Address you copied from the Serial Monitor into **Zone D**.
6. The ping interval will now fetch real-time temp, smoke, and switch your dashboard components into Live Hardware mode!
