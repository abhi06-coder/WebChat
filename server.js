const express = require('express');
const admin = require('firebase-admin');
const http = require('http').createServer(express());
const io = require('socket.io')(http);
const app = express();
const path = require('path');

// Replace with the correct path to your serviceAccountKey file
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://webchat-d6455-default-rtdb.asia-southeast1.firebasedatabase.app'
});

const db = admin.database();

app.use(express.static('public'));

const messageReactions = {};
const usersInRooms = {};

async function getRoom(code) {
  const snapshot = await db.ref(`rooms/${code}`).once('value');
  return snapshot.exists() ? snapshot.val() : null;
}

async function createRoom(code, password, adminId) {
  await db.ref(`rooms/${code}`).set({ password, admin_id: adminId });
}

async function updateAdmin(code, newAdminId) {
  await db.ref(`rooms/${code}/admin_id`).set(newAdminId);
}

async function deleteRoom(code) {
  await db.ref(`rooms/${code}`).remove();
}

io.on('connection', socket => {
  socket.on('join-room', async ({ userName, roomCode, password, create }) => {
    if (!roomCode || roomCode.length > 20 || password.length > 30) return;

    const room = await getRoom(roomCode);

    if (!room) {
      if (!create) {
        socket.emit('room-error', 'Room does not exist.');
        return;
      }
      await createRoom(roomCode, password, socket.id);
      usersInRooms[roomCode] = {};
    } else {
      if (room.password !== password) {
        socket.emit('room-error', 'Incorrect password.');
        return;
      }
    }

    socket.join(roomCode);
    socket.userName = userName;
    socket.roomCode = roomCode;

    if (!usersInRooms[roomCode]) usersInRooms[roomCode] = {};
    usersInRooms[roomCode][socket.id] = userName;

    const updatedRoom = await getRoom(roomCode);

    io.to(roomCode).emit('room-users', {
      users: Object.entries(usersInRooms[roomCode]).map(([id, name]) => ({
        id, name, isAdmin: id === updatedRoom.admin_id
      })),
      adminId: updatedRoom.admin_id
    });

    io.to(roomCode).emit('chat-message', {
      userName: 'System',
      text: `${userName} joined the chat.`,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      messageId: `sys-${Date.now()}`,
      senderId: 'system'
    });
  });

  socket.on('chat-message', ({ roomCode, userName, text, time, messageId }) => {
    io.to(roomCode).emit('chat-message', {
      userName,
      text,
      time,
      messageId,
      senderId: socket.id
    });
  });

  socket.on('typing', ({ roomCode, userName }) => {
    socket.to(roomCode).emit('user-typing', userName);
  });

  socket.on('stop-typing', roomCode => {
    socket.to(roomCode).emit('user-stop-typing');
  });

  socket.on('react-message', ({ roomCode, messageId, emoji, userName }) => {
    if (!messageReactions[roomCode]) messageReactions[roomCode] = {};
    if (!messageReactions[roomCode][messageId]) {
      messageReactions[roomCode][messageId] = [];
    }

    const reactions = messageReactions[roomCode][messageId];
    const existing = reactions.find(r => r.emoji === emoji);

    if (existing) {
      if (existing.users.includes(userName)) {
        existing.count--;
        existing.users = existing.users.filter(u => u !== userName);
        if (existing.count === 0) {
          messageReactions[roomCode][messageId] = reactions.filter(r => r.count > 0);
        }
      } else {
        existing.count++;
        existing.users.push(userName);
      }
    } else {
      reactions.push({ emoji, count: 1, users: [userName] });
    }

    io.to(roomCode).emit('update-reactions', {
      messageId,
      reactions: messageReactions[roomCode][messageId]
    });
  });

  socket.on('edit-message', ({ roomCode, messageId, newText }) => {
    io.to(roomCode).emit('edit-message', { messageId, newText });
  });

  socket.on('delete-message', ({ roomCode, messageId }) => {
    io.to(roomCode).emit('delete-message', messageId);
  });

  socket.on('kick-user', async ({ roomCode, targetId }) => {
    const room = await getRoom(roomCode);
    if (!room || socket.id !== room.admin_id) return;

    io.to(targetId).emit('kicked');
    io.sockets.sockets.get(targetId)?.leave(roomCode);
    delete usersInRooms[roomCode][targetId];

    io.to(roomCode).emit('room-users', {
      users: Object.entries(usersInRooms[roomCode]).map(([id, name]) => ({
        id, name, isAdmin: id === room.admin_id
      })),
      adminId: room.admin_id
    });

    io.to(roomCode).emit('chat-message', {
      userName: 'System',
      text: `A user was kicked from the room.`,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      messageId: `sys-${Date.now()}`,
      senderId: 'system'
    });
  });

  socket.on('disconnect', async () => {
    const roomCode = socket.roomCode;
    if (!roomCode || !usersInRooms[roomCode]) return;

    const room = await getRoom(roomCode);
    const userName = socket.userName;

    delete usersInRooms[roomCode][socket.id];

    if (socket.id === room.admin_id) {
      const newAdmin = Object.keys(usersInRooms[roomCode])[0];
      if (newAdmin) {
        await updateAdmin(roomCode, newAdmin);
      }
    }

    const updatedRoom = await getRoom(roomCode);

    io.to(roomCode).emit('room-users', {
      users: Object.entries(usersInRooms[roomCode]).map(([id, name]) => ({
        id, name, isAdmin: id === updatedRoom?.admin_id
      })),
      adminId: updatedRoom?.admin_id
    });

    io.to(roomCode).emit('chat-message', {
      userName: 'System',
      text: `${userName} left the chat.`,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      messageId: `sys-${Date.now()}`,
      senderId: 'system'
    });

    if (Object.keys(usersInRooms[roomCode]).length === 0) {
      await deleteRoom(roomCode);
      delete usersInRooms[roomCode];
    }
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on port ${PORT}`));
