
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

// Bugatti 3D modeli
app.get('/models/bugatti-chiron.glb', (req, res) => {
  const bugattiPath = path.join(__dirname, 'bugatti-chiron.glb');

  if (!fs.existsSync(bugattiPath)) {
    console.error('Bugatti GLB bulunamadı:', bugattiPath);
    return res.status(404).send('Bugatti modeli bulunamadı.');
  }

  res.type('model/gltf-binary');
  res.sendFile(bugattiPath);
});

// Dosyaları yayınla
app.use(express.static(__dirname));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  const indexPath = path.join(__dirname, 'index.html');

  if (!fs.existsSync(indexPath)) {
    return res.status(404).send('index.html bulunamadı.');
  }

  res.sendFile(indexPath);
});

app.get('/index.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'yigit-sehir-surusu'
  });
});

const rooms = new Map();
const raceWinners = new Map();
const pendingRoomTravels = new Map();

function makeCode() {
  let c;

  do {
    c = String(
      Math.floor(100000 + Math.random() * 900000)
    );
  } while (rooms.has(c));

  return c;
}

// Geçiş oylamasını bitir
function finishRoomTravel(code, approved, reason) {
  const pending = pendingRoomTravels.get(code);
  if (!pending) return;

  clearTimeout(pending.timeout);
  pendingRoomTravels.delete(code);

  if (approved) {
    io.to(code).emit('room-travel-approved', {
      requestId: pending.requestId,
      destination: pending.destination
    });
  } else {
    io.to(code).emit('room-travel-rejected', {
      requestId: pending.requestId,
      destination: pending.destination,
      reason: reason || 'Oylama kabul edilmedi.'
    });
  }
}

// Oylama durumunu güncelle
function updateRoomTravelVote(code) {
  const pending = pendingRoomTravels.get(code);
  const room = rooms.get(code);

  if (!pending || !room) return;

  const total = room.size;
  const yes = pending.yes.size;
  const no = pending.no.size;

  io.to(code).emit('room-travel-vote-update', {
    requestId: pending.requestId,
    yes,
    no,
    total
  });

  if (no > 0) {
    finishRoomTravel(
      code,
      false,
      'Bir oyuncu geçişi reddetti.'
    );
  } else if (yes >= total) {
    finishRoomTravel(code, true);
  }
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

    if (pendingRoomTravels.has(code)) {
      updateRoomTravelVote(code);
    }
  });

  // Backrooms ve diğer alanlara geçiş isteği
  socket.on('request-room-travel', (data, ack) => {
    const code = socket.data.room;
    const room = code && rooms.get(code);

    const destination = String(
      data?.destination || ''
    );

    if (!room || !room.has(socket.id)) {
      if (typeof ack === 'function') {
        ack({
          ok: false,
          error: 'Oda bulunamadı.'
        });
      }
      return;
    }

    if (![
      'backrooms',
      'city',
      'race',
      'parking'
    ].includes(destination)) {
      if (typeof ack === 'function') {
        ack({
          ok: false,
          error: 'Geçersiz geçiş hedefi.'
        });
      }
      return;
    }

    if (pendingRoomTravels.has(code)) {
      if (typeof ack === 'function') {
        ack({
          ok: false,
          error: 'Bu odada zaten bir geçiş oylaması var.'
        });
      }
      return;
    }

    const requestId = `${Date.now()}-${socket.id}`;

    const pending = {
      requestId,
      destination,
      requesterId: socket.id,
      yes: new Set([socket.id]),
      no: new Set(),
      timeout: null
    };

    pending.timeout = setTimeout(() => {
      finishRoomTravel(
        code,
        false,
        'Geçiş oylamasının süresi doldu.'
      );
    }, 30000);

    pendingRoomTravels.set(code, pending);

    if (typeof ack === 'function') {
      ack({
        ok: true,
        requestId
      });
    }

    socket.to(code).emit('room-travel-request', {
      requestId,
      id: requestId,
      destination,
      name: String(
        data?.name || 'Bir oyuncu'
      ).slice(0, 32),
      from: socket.id
    });

    updateRoomTravelVote(code);
  });

  // Oyuncunun oyunu
  socket.on('vote-room-travel', data => {
    const code = socket.data.room;
    const room = code && rooms.get(code);
    const pending = code && pendingRoomTravels.get(code);

    if (!room || !pending || !room.has(socket.id)) return;

    if (
      String(data?.requestId || '') !== pending.requestId
    ) return;

    if (socket.id === pending.requesterId) return;

    if (
      pending.yes.has(socket.id) ||
      pending.no.has(socket.id)
    ) return;

    if (data?.yes === true) {
      pending.yes.add(socket.id);
    } else {
      pending.no.add(socket.id);
    }

    updateRoomTravelVote(code);
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
      name: String(
        data?.name || 'Bir oyuncu'
      ).slice(0, 32),
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
    const pending = pendingRoomTravels.get(code);

    if (pending) {
      if (pending.requesterId === socket.id) {
        finishRoomTravel(
          code,
          false,
          'İsteği gönderen oyuncu odadan ayrıldı.'
        );
      } else {
        pending.yes.delete(socket.id);
        pending.no.delete(socket.id);
      }
    }

    room.delete(socket.id);

    socket.to(code).emit('player-left', socket.id);

    if (room.size === 0) {
      rooms.delete(code);
      raceWinners.delete(code);

      const remaining = pendingRoomTravels.get(code);

      if (remaining) {
        clearTimeout(remaining.timeout);
        pendingRoomTravels.delete(code);
      }
    } else if (pendingRoomTravels.has(code)) {
      updateRoomTravelVote(code);
    }
  });
});

const port = process.env.PORT || 3000;

server.listen(port, '0.0.0.0', () => {
  console.log('Server listening on ' + port);
});
