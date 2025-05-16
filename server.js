const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public'));

const rooms = {};
const messageReactions = {}; // { roomCode: { messageId: [ {emoji, count, users} ] } }

io.on('connection', socket => {

  socket.on('join-room', ({ userName, roomCode }) => {
    socket.join(roomCode);
    socket.userName = userName;
    socket.roomCode = roomCode;

    if (!rooms[roomCode]) rooms[roomCode] = {};
    rooms[roomCode][socket.id] = userName;

    io.to(roomCode).emit('room-users', Object.values(rooms[roomCode]));
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
      if (!existing.users.includes(userName)) {
        existing.count++;
        existing.users.push(userName);
      }
    } else {
      reactions.push({ emoji, count: 1, users: [userName] });
    }

    io.to(roomCode).emit('update-reactions', {
      messageId,
      reactions
    });
  });

  socket.on('edit-message', ({ roomCode, messageId, newText }) => {
    io.to(roomCode).emit('edit-message', { messageId, newText });
  });

  socket.on('delete-message', ({ roomCode, messageId }) => {
    io.to(roomCode).emit('delete-message', messageId);
  });

  socket.on('disconnect', () => {
    const room = socket.roomCode;
    if (room && rooms[room]) {
      delete rooms[room][socket.id];
      io.to(room).emit('room-users', Object.values(rooms[room]));
      if (Object.keys(rooms[room]).length === 0) {
        delete rooms[room];
        delete messageReactions[room];
      }
    }
  });
});

http.listen(3000, () => console.log('Server running at http://localhost:3000'));
