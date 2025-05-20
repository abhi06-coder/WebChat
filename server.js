const express = require('express');
const admin = require('firebase-admin');
const path = require('path');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: 'https://webchat-d6455-default-rtdb.asia-southeast1.firebasedatabase.app'
});

const db = admin.database();

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const messageReactions = {};
const usersInRooms = {};

async function getRoom(code) {
    try {
        const snapshot = await db.ref(`rooms/${code}`).once('value');
        return snapshot.exists() ? snapshot.val() : null;
    } catch {
        return null;
    }
}

async function createRoom(code, password, adminId) {
    try {
        await db.ref(`rooms/${code}`).set({ password, admin_id: adminId });
        return true;
    } catch {
        return false;
    }
}

async function updateAdmin(code, newAdminId) {
    try {
        await db.ref(`rooms/${code}/admin_id`).set(newAdminId);
        return true;
    } catch {
        return false;
    }
}

async function deleteRoom(code) {
    try {
        await db.ref(`rooms/${code}`).remove();
        return true;
    } catch {
        return false;
    }
}

io.on('connection', socket => {
    socket.on('join-room', async ({ userName, roomCode, password, create }) => {
        if (!roomCode || roomCode.trim() === "" || roomCode.length > 20) {
            socket.emit('room-error', 'Invalid room code.');
            return;
        }
        if (!userName || userName.trim() === "") {
            socket.emit('room-error', 'Enter your name.');
            return;
        }
        if (password && password.length > 30) {
            socket.emit('room-error', 'Password too long.');
            return;
        }

        roomCode = roomCode.trim();
        userName = userName.trim();
        password = password || "";

        const room = await getRoom(roomCode);

        if (!room) {
            if (!create) {
                socket.emit('room-error', 'Room does not exist.');
                return;
            }
            if (!password) {
                socket.emit('room-error', 'Password required to create room.');
                return;
            }
            if (await createRoom(roomCode, password, socket.id)) {
                usersInRooms[roomCode] = {};
            } else {
                socket.emit('room-error', 'Room creation failed.');
                return;
            }
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
                id, name, isAdmin: id === updatedRoom?.admin_id
            })),
            adminId: updatedRoom?.admin_id
        });

        io.to(roomCode).emit('chat-message', {
            userName: 'System',
            text: `${userName} joined.`,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            messageId: `sys-${Date.now()}`,
            senderId: 'system'
        });
    });

    socket.on('chat-message', ({ roomCode, userName, text, time, messageId }) => {
        if (!roomCode || !userName || !text) return;
        io.to(roomCode).emit('chat-message', {
            userName,
            text,
            time,
            messageId,
            senderId: socket.id
        });
    });

    socket.on('typing', ({ roomCode, userName }) => {
        if (roomCode && userName) {
            socket.to(roomCode).emit('user-typing', userName);
        }
    });

    socket.on('stop-typing', roomCode => {
        if (roomCode) {
            socket.to(roomCode).emit('user-stop-typing');
        }
    });

    socket.on('react-message', ({ roomCode, messageId, emoji, userName }) => {
        if (!roomCode || !messageId || !emoji || !userName) return;
        if (!messageReactions[roomCode]) messageReactions[roomCode] = {};
        if (!messageReactions[roomCode][messageId]) {
            messageReactions[roomCode][messageId] = [];
        }

        const reactions = messageReactions[roomCode][messageId];
        const existing = reactions.find(r => r.emoji === emoji && r.users.includes(userName));

        if (existing) {
            existing.count--;
            existing.users = existing.users.filter(u => u !== userName);
        } else {
            const reaction = reactions.find(r => r.emoji === emoji);
            if (reaction) {
                reaction.count++;
                reaction.users.push(userName);
            } else {
                reactions.push({ emoji, count: 1, users: [userName] });
            }
        }

        messageReactions[roomCode][messageId] = reactions.filter(r => r.count > 0);

        io.to(roomCode).emit('update-reactions', {
            messageId,
            reactions: messageReactions[roomCode][messageId]
        });
    });

    socket.on('edit-message', ({ roomCode, messageId, newText }) => {
        if (roomCode && messageId && newText) {
            io.to(roomCode).emit('edit-message', { messageId, newText });
        }
    });

    socket.on('delete-message', ({ roomCode, messageId }) => {
        if (roomCode && messageId) {
            io.to(roomCode).emit('delete-message', messageId);
        }
    });

    socket.on('kick-user', async ({ roomCode, targetId }) => {
        if (!roomCode || !targetId) return;
        const room = await getRoom(roomCode);
        if (!room || socket.id !== room.admin_id) return;

        const kickedSocket = io.sockets.sockets.get(targetId);
        if (kickedSocket) {
            kickedSocket.emit('kicked');
            kickedSocket.leave(roomCode);
        }
        delete usersInRooms[roomCode][targetId];

        const updatedRoom = await getRoom(roomCode);
        io.to(roomCode).emit('room-users', {
            users: Object.entries(usersInRooms[roomCode]).map(([id, name]) => ({
                id, name, isAdmin: id === updatedRoom?.admin_id
            })),
            adminId: updatedRoom?.admin_id
        });

        io.to(roomCode).emit('chat-message', {
            userName: 'System',
            text: `A user was kicked.`,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            messageId: `sys-${Date.now()}`,
            senderId: 'system'
        });
    });

    socket.on('disconnect', async () => {
        const roomCode = socket.roomCode;
        if (!roomCode || !usersInRooms[roomCode] || !socket.userName) return;

        const userName = socket.userName;
        delete usersInRooms[roomCode][socket.id];

        const room = await getRoom(roomCode);
        if (socket.id === room?.admin_id) {
            const remainingUsers = Object.keys(usersInRooms[roomCode]);
            if (remainingUsers.length > 0) {
                await updateAdmin(roomCode, remainingUsers[0]);
            } else {
                await deleteRoom(roomCode);
                delete usersInRooms[roomCode];
                delete messageReactions[roomCode];
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
            text: `${userName} left.`,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            messageId: `sys-${Date.now()}`,
            senderId: 'system'
        });

        if (Object.keys(usersInRooms[roomCode] || {}).length === 0 && room) {
            await deleteRoom(roomCode);
            delete usersInRooms[roomCode];
            delete messageReactions[roomCode];
        }

        delete socket.roomCode;
        delete socket.userName;
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on port ${PORT}`));
