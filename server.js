const express = require('express');
const admin = require('firebase-admin');
const path = require('path'); // Make sure this is required

// 1. Create the Express application instance FIRST
const app = express(); // This is the instance you will configure

// 2. Then, create the HTTP server using that 'app' instance
const http = require('http').createServer(app); // <-- Pass 'app' here!

// 3. Attach Socket.IO to the 'http' server
const io = require('socket.io')(http);

// Replace with the correct path to your serviceAccountKey file
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: 'https://webchat-d6455-default-rtdb.asia-southeast1.firebasedatabase.app'
});

const db = admin.database();

// These configurations for 'app' will now be correctly handled by 'http'
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ... (rest of your server.js code, including http.listen) ...
const messageReactions = {};
const usersInRooms = {};

async function getRoom(code) {
    try {
        const snapshot = await db.ref(`rooms/${code}`).once('value');
        return snapshot.exists() ? snapshot.val() : null;
    } catch (error) {
        console.error("Error getting room:", error);
        return null;
    }
}

async function createRoom(code, password, adminId) {
    try {
        await db.ref(`rooms/${code}`).set({ password, admin_id: adminId });
        return true;
    } catch (error) {
        console.error("Error creating room:", error);
        return false;
    }
}

async function updateAdmin(code, newAdminId) {
    try {
        await db.ref(`rooms/${code}/admin_id`).set(newAdminId);
        return true;
    } catch (error) {
        console.error("Error updating admin:", error);
        return false;
    }
}

async function deleteRoom(code) {
    try {
        await db.ref(`rooms/${code}`).remove();
        return true;
    } catch (error) {
        console.error("Error deleting room:", error);
        return false;
    }
}

io.on('connection', socket => {
    socket.on('join-room', async ({ userName, roomCode, password, create }) => {
        if (!roomCode || roomCode.trim() === "" || roomCode.length > 20) {
            socket.emit('room-error', 'Invalid room code. Please enter a valid code (max 20 characters).');
            return;
        }
        if (!userName || userName.trim() === "") {
            socket.emit('room-error', 'Please enter your name.');
            return;
        }
        if (password && password.length > 30) {
            socket.emit('room-error', 'Invalid password (max 30 characters).');
            return;
        }

        roomCode = roomCode.trim();
        userName = userName.trim();
        password = password ? password : ""; // Ensure password is a string

        const room = await getRoom(roomCode);

        if (!room) {
            if (!create) {
                socket.emit('room-error', 'Room does not exist.');
                return;
            }
            if (!password) {
                socket.emit('room-error', 'A password is required to create a new private room.');
                return;
            }
            if (await createRoom(roomCode, password, socket.id)) {
                usersInRooms[roomCode] = {};
            } else {
                socket.emit('room-error', 'Failed to create the room. Please try again.');
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

        try {
            const updatedRoom = await getRoom(roomCode);
            io.to(roomCode).emit('room-users', {
                users: Object.entries(usersInRooms[roomCode]).map(([id, name]) => ({
                    id, name, isAdmin: id === updatedRoom?.admin_id
                })),
                adminId: updatedRoom?.admin_id
            });

            io.to(roomCode).emit('chat-message', {
                userName: 'System',
                text: `${userName} joined the chat.`,
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                messageId: `sys-${Date.now()}`,
                senderId: 'system'
            });
        } catch (error) {
            console.error("Error during post-join actions:", error);
        }
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
            if (existing.count === 0) {
                messageReactions[roomCode][messageId] = reactions.filter(r => r.count > 0);
            }
        } else {
            const reaction = reactions.find(r => r.emoji === emoji);
            if (reaction) {
                reaction.count++;
                reaction.users.push(userName);
            } else {
                reactions.push({ emoji, count: 1, users: [userName] });
            }
        }

        io.to(roomCode).emit('update-reactions', {
            messageId,
            reactions: messageReactions[roomCode][messageId].filter(r => r.count > 0)
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
        try {
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
                text: `A user was kicked from the room.`,
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                messageId: `sys-${Date.now()}`,
                senderId: 'system'
            });
        } catch (error) {
            console.error("Error during kick user:", error);
        }
    });

    socket.on('disconnect', async () => {
        const roomCode = socket.roomCode;
        if (!roomCode || !usersInRooms[roomCode] || !socket.userName) return;

        const userName = socket.userName;

        delete usersInRooms[roomCode][socket.id];

        try {
            const room = await getRoom(roomCode);
            if (socket.id === room?.admin_id) {
                const remainingUsers = Object.keys(usersInRooms[roomCode]);
                if (remainingUsers.length > 0) {
                    await updateAdmin(roomCode, remainingUsers[0]);
                } else {
                    await deleteRoom(roomCode);
                    delete usersInRooms[roomCode];
                    delete messageReactions[roomCode]; // Clean up reactions for the room
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

            if (Object.keys(usersInRooms[roomCode] || {}).length === 0 && room) {
                await deleteRoom(roomCode);
                delete usersInRooms[roomCode];
                delete messageReactions[roomCode]; // Clean up reactions if room is empty
            }
        } catch (error) {
            console.error("Error during disconnect:", error);
        } finally {
            delete socket.roomCode;
            delete socket.userName;
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on port ${PORT}`));
