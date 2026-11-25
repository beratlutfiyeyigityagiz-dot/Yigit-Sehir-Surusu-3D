
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: true,
    methods: ['GET', 'POST']
  }
});

// Ana klasördeki dosyaları yayınla
app.use(express.static(__dirname));

// Varsa public klasörünü de yayınla
app.use(express.static(path.join(__dirname, 'public')));

// Ana sayfa
app.get('/', (req, res) => {
  const indexPath = path.join(__dirname, 'index.html');

  if (!fs.existsSync(indexPath)) {
    console.error('index.html bulunamadı:', indexPath);
    return res.status(404).send('index.html dosyası bulunamadı.');
  }

  res.sendFile(indexPath);
});

// Index dosyasına doğrudan erişim
app.get('/index.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Sağlık kontrolü
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'yigit-sehir-surusu'
  });
});

const rooms = new Map();
const raceWinners = new Map();

function makeCode() {
  let c;

  do {
    c = String(
      Math.floor(100000 + Math.random() * 900000)
    );
  } while (rooms.has(c));

  return c;
}

io.on('connection', socket => {

  // Oda oluştur
  socket.on('create-room', () => {
    const code = makeCode();

    rooms.set(code, new Map([
      [socket.id, {
        id: socket.id,
        x: 0,
        y: 0.55,
        z: 0,
        rot: 0,
        vehicle: 'Standart'
      }]
    ]));

    socket.join(code);
    socket.data.room = code;

    socket.emit('room-created', {
      code,
      id: socket.id
    });
  });

  // Odaya katıl
  socket.on('join-room', raw => {
    const code = String(raw || '').replace(/\D/g, '');

    if (!/^\d{6}$/.test(code)) {
      socket.emit('room-error', 'Oda kodu 6 rakam olmalı.');
      return;
    }

    const room = rooms.get(code);

    if (!room) {
      socket.emit('room-error', 'Bu kodla açık bir oda bulunamadı.');
      return;
    }

    if (room.size >= 8) {
      socket.emit('room-error', 'Oda dolu (en fazla 8 oyuncu).');
      return;
    }

    const players = [...room.values()];

    const player = {
      id: socket.id,
      x: 0,
      y: 0.55,
      z: 0,
      rot: 0,
      vehicle: 'Standart'
    };

    room.set(socket.id, player);

    socket.join(code);
    socket.data.room = code;

    socket.emit('room-joined', {
      code,
      id: socket.id,
      players
    });

    socket.to(code).emit('player-joined', player);
  });

  // Yarışı başlat
  socket.on('race-start', () => {
    const code = socket.data.room;

    if (!code || !rooms.has(code)) return;

    raceWinners.delete(code);
    io.to(code).emit('race-start');
  });

  // Yarışı bitir
  socket.on('race-finish', data => {
    const code = socket.data.room;

    if (!code || !rooms.has(code)) return;
    if (raceWinners.has(code)) return;

    raceWinners.set(code, socket.id);

    io.to(code).emit('race-winner', {
      id: socket.id,
      name: String(data?.name || 'Bir oyuncu').slice(0, 32),
      reward: 500
    });
  });

  // Araç hareket bilgileri
  socket.on('drive-state', state => {
    const code = socket.data.room;

    if (!code || !rooms.has(code)) return;

    const room = rooms.get(code);
    const player = room.get(socket.id);

    if (!player) return;

    for (const key of ['x', 'y', 'z', 'rot']) {
      const number = Number(state?.[key]);

      if (Number.isFinite(number)) {
        player[key] = Math.max(
          -10000,
          Math.min(10000, number)
        );
      }
    }

    if (typeof state?.vehicle === 'string') {
      player.vehicle = state.vehicle.slice(0, 40);
    }

    socket.to(code).emit('state', player);
  });

  // Oyuncu ayrıldı
  socket.on('disconnect', () => {
    const code = socket.data.room;

    if (!code || !rooms.has(code)) return;

    const room = rooms.get(code);

    room.delete(socket.id);

    socket.to(code).emit('player-left', socket.id);

    if (room.size === 0) {
      rooms.delete(code);
      raceWinners.delete(code);
    }
  });
});

const port = process.env.PORT || 3000;

server.listen(port, '0.0.0.0', () => {
  console.log('Server listening on ' + port);
});
