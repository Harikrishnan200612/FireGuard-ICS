const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// Initialize Express app
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3002;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.text()); // Added to handle raw text bodies
app.use(express.static(__dirname));

//Permissive body parser for hardware without headers
app.use((req, res, next) => {
  if (req.method === 'POST' && (!req.body || Object.keys(req.body).length === 0)) {
    let rawData = '';
    req.on('data', chunk => { rawData += chunk; });
    req.on('end', () => {
      if (rawData) {
        try {
          req.body = JSON.parse(rawData);
        } catch (e) {
          try {
            const params = new URLSearchParams(rawData);
            params.forEach((v, k) => { req.body = req.body || {}; req.body[k] = v; });
          } catch (e2) {}
        }
      }
      next();
    });
  } else {
    next();
  }
});

// Debug middleware
app.use((req, res, next) => {
  console.log(`[DEBUG] Incoming: ${req.method} ${req.path} from ${req.ip}`);
  if (req.path === '/api/trigger-alert' && req.method === 'POST') {
    console.log(`[DEBUG] Headers:`, req.headers);
    console.log(`[DEBUG] Body:`, req.body);
  }
  next();
});

// --- SYSTEM STATE ---
let systemState = {
  temperature: 24.5,
  smoke: 450,
  alerts: 0,
  alertLevel: 0,
  lastUpdate: new Date().toISOString(),
  zones: {
    'A': { name: 'Lobby', status: 'safe', temp: 24.2, smoke: 420, fans: ['FAN-A1'], pumps: [], people: 3, hw: false },
    'B': { name: 'Main Hall', status: 'safe', temp: 23.8, smoke: 380, fans: ['FAN-B1', 'FAN-B2'], pumps: [], people: 5, hw: false },
    'C': { name: 'Production Room', status: 'safe', temp: 26.5, smoke: 510, fans: ['FAN-C1'], pumps: ['PUMP-C1'], people: 8, hw: false },
    'D': { name: 'Storage [Lab]', status: 'safe', temp: 25.1, smoke: 460, fans: ['FAN-D1'], pumps: [], people: 2, hw: false },
    'E': { name: 'Exit Corridor', status: 'safe', temp: 22.9, smoke: 390, fans: [], pumps: ['PUMP-E1'], people: 1, hw: false }
  },
  thresholds: {
    tempWarn: 40,
    tempCrit: 55,
    smokeWarn: 4000, // Aligned with ESP32
    smokeCrit: 4050  // Aligned with ESP32
  },
  overrides: {
    fan: false,
    pump: false
  },
  lastHardwareUpdate: null,
  tasks: [
    { id: 1, zone: 'A', text: 'Verify Exit Sign A1', status: 'TODO' },
    { id: 2, zone: 'B', text: 'Calibrate Humidity Sensor', status: 'TODO' },
    { id: 3, zone: 'C', text: 'Check Backup Power', status: 'TODO' },
    { id: 4, zone: 'D', text: 'Inspect ESP32 Wiring', status: 'TODO' },
    { id: 5, zone: 'D', text: 'Clean Smoke Detector', status: 'TODO' },
    { id: 6, zone: 'E', text: 'Test Emergency Lighting', status: 'TODO' }
  ]
};

// Telegram Configuration
const TELEGRAM_TOKEN = "7864353842:AAEY9MvB801iR9j6V5zJ0gJ8_G8G_Z8K_Z8"; // Placeholder, user should update
const CHAT_ID = "123456789"; // Placeholder, user should update

function sendTelegramAlert(msg) {
  if (!TELEGRAM_TOKEN.includes("AAEY")) return; // Skip if still placeholder
  
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  const data = JSON.stringify({ chat_id: CHAT_ID, text: msg });

  const https = require('https');
  const req = https.request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': data.length
    }
  }, (res) => {
    console.log(`[TELEGRAM] Response: ${res.statusCode}`);
  });

  req.on('error', (e) => {
    console.error(`[TELEGRAM] Error: ${e.message}`);
  });

  req.write(data);
  req.end();
}

// --- SIMULATION LOOP ---
// Only simulate zones that haven't received hardware data recently
setInterval(() => {
  const now = Date.now();
  Object.keys(systemState.zones).forEach(z => {
    let zone = systemState.zones[z];
    
    // Skip simulation for Zone D if it's currently receiving real data (last 10s)
    const isHardwareActive = (z === 'D' && systemState.lastHardwareUpdate && (now - systemState.lastHardwareUpdate < 10000));
    
    if (!isHardwareActive) {
      zone.hw = false;
      // Normal simulation noise
      zone.temp += (Math.random() - 0.5) * 0.4;
      zone.smoke += Math.floor((Math.random() - 0.5) * 10);
      
      // Keep in reasonable range
      if (zone.temp < 15) zone.temp = 20;
      if (zone.temp > 45) zone.temp = 30;
      if (zone.smoke < 100) zone.smoke = 400;
      if (zone.smoke > 1200) zone.smoke = 600;
    } else {
      zone.hw = true;
    }
    
    // Evaluate status based on thresholds
    if (zone.temp >= systemState.thresholds.tempCrit || zone.smoke >= systemState.thresholds.smokeCrit) {
      zone.status = 'fire';
    } else if (zone.temp >= systemState.thresholds.tempWarn || zone.smoke >= systemState.thresholds.smokeWarn) {
      zone.status = 'warn';
    } else {
      zone.status = 'safe';
    }
  });

  // Global aggregate stats
  systemState.temperature = systemState.zones['D'].temp; // Dashboard usually follows Zone D
  systemState.smoke = systemState.zones['D'].smoke;
  
  const anyFire = Object.values(systemState.zones).some(z => z.status === 'fire');
  const anyWarn = Object.values(systemState.zones).some(z => z.status === 'warn');
  
  if (anyFire) systemState.alertLevel = 2;
  else if (anyWarn) systemState.alertLevel = 1;
  else systemState.alertLevel = 0;

  systemState.lastUpdate = new Date().toISOString();

  // Send baseline sync to all clients
  io.emit('stateUpdate', systemState);
}, 2000);

// --- API ENDPOINTS ---

// GET /data - Polling endpoint used by some clients
app.get('/data', (req, res) => {
  res.json({
    device: "FG-SERVER-MAIN",
    ...systemState,
    uptime: process.uptime(),
    wifiRSSI: -45,
    hwConnected: !!(systemState.lastHardwareUpdate && (Date.now() - systemState.lastHardwareUpdate < 10000))
  });
});

// POST /control - Manual overrides
app.post('/control', (req, res) => {
  const { type, value, thresholds } = req.body;
  if (thresholds) {
    systemState.thresholds = { ...systemState.thresholds, ...thresholds };
  }
  if (type === 'fanOverride') systemState.overrides.fan = value;
  if (type === 'pumpOverride') systemState.overrides.pump = value;
  
  res.json({ success: true, state: systemState });
});

app.post('/api/trigger-alert', (req, res) => {
  // Support nested 'zd' object or flat structure, and query params
  const b = req.body;
  const q = req.query;
  const zd = b.zd || {};
  
  const temp = zd.temp || b.temp || b.temperature || q.temp || q.temperature;
  const smoke = zd.smoke || b.smoke || b.smoke_adc || q.smoke || q.smoke_adc;
  const humidity = zd.humidity || b.humidity || b.hum || q.humidity || q.hum;
  const targetZone = b.zone || q.zone || 'D';
  
  console.log(`[HARDWARE] SUCCESS: Zone ${targetZone}, Temp: ${temp}, Smoke: ${smoke}`);

    if (systemState.zones[targetZone]) {
      systemState.zones[targetZone].temp = parseFloat(temp) || systemState.zones[targetZone].temp;
      systemState.zones[targetZone].smoke = parseInt(smoke) || systemState.zones[targetZone].smoke;
      systemState.zones[targetZone].humidity = parseFloat(humidity) || 52;
      systemState.zones[targetZone].hw = true;
      systemState.lastHardwareUpdate = Date.now();
      
      // FIRE ALERT TRIGGER: Check against thresholds and notify Telegram
      if (systemState.zones[targetZone].temp >= systemState.thresholds.tempCrit) {
        sendTelegramAlert(`🚨 FIRE ALERT\nZone: ${targetZone}\nTemp: ${temp}°C\nSmoke: ${smoke}\nStatus: CRITICAL`);
        console.log(`[TELEGRAM] Triggering alert for Zone ${targetZone}`);
      }

      // Emit the specific 'sensorUpdate' event the frontend script expects
      io.emit('sensorUpdate', {
        zone: targetZone,
        temp: systemState.zones[targetZone].temp,
        smoke: systemState.zones[targetZone].smoke,
        humidity: systemState.zones[targetZone].humidity
      });
    }
    
    res.json({ success: true });
});

// --- FIELD TASK ENGINGE ---
app.post('/api/tasks/complete', (req, res) => {
    const { taskId } = req.body;
    const task = systemState.tasks.find(t => t.id === taskId);
    if (task) {
        task.status = 'DONE';
        console.log(`[TASK] Task ${taskId} completed`);
        io.emit('taskUpdate', systemState.tasks);
    }
    res.json({ success: true });
});

app.get('/api/tasks', (req, res) => {
    res.json(systemState.tasks);
});

app.get('/health', (req, res) => {
  res.json({ status: "online", hardwareActive: !!systemState.lastHardwareUpdate });
});

app.post('/reset', (req, res) => {
  systemState.overrides = { fan: false, pump: false };
  res.json({ success: true });
});

// Serve the dashboard
app.get('/', (req, res) => {
  const targetFile = 'index (1).html';
  if (fs.existsSync(path.join(__dirname, targetFile))) {
    res.sendFile(path.join(__dirname, targetFile));
  } else {
    res.sendFile(path.join(__dirname, 'index.html'));
  }
});

// SPA Catch-all
app.use((req, res) => {
    const targetFile = 'index (1).html';
    if (fs.existsSync(path.join(__dirname, targetFile))) {
        res.sendFile(path.join(__dirname, targetFile));
    } else {
        res.status(404).send('Not Found');
    }
});

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  socket.emit('stateUpdate', systemState);
  socket.emit('taskUpdate', systemState.tasks);
  
  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`
  🚀 FireGuard ICS v2.0 READY
  --------------------------
  Hardware Port: ${PORT}
  Dashboard: http://localhost:${PORT}
  Zone D: Waiting for ESP32...
  `);
});
