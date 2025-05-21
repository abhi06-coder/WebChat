const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const { MongoClient } = require('mongodb');

const app = express();
const httpServer = http.createServer(app);
const ioServer = socketIo(httpServer);

const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://abhi:Abhinav%4006@webchat.1vvhscv.mongodb.net/chatdb?retryWrites=true&w=majority&appName=webchat";
const client = new MongoClient(MONGODB_URI);
let roomsCollection;

async function connectToDatabase() {
    try {
        await client.connect();
        console.log("Connected to MongoDB Atlas!");
        const db = client.db('chatdb');
        roomsCollection = db.collection('rooms');
        await roomsCollection.createIndex({ code: 1 }, { unique: true }).catch(err => {
            if (err.code !== 48) {
                console.warn("Could not create unique index on rooms.code:", err.message);
            }
        });
    } catch (error) {
        console.error("MongoDB connection error:", error);
        process.exit(1);
    }
}

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const messageReactions = {};
const usersInRooms = {};

async function getRoom(code) {
    try {
        return await roomsCollection.findOne({ code: code });
    } catch (error) {
        console.error("Error getting room from MongoDB:", error);
        return null;
    }
}

async function createRoom(code, password, adminId) {
    try {
        await roomsCollection.insertOne({ code: code, password: password, admin_id: adminId });
        return true;
    } catch (error) {
        if (error.code === 11000) return false;
        console.error("Error creating room in MongoDB:", error);
        return false;
    }
}

async function updateAdmin(code, newAdminId) {
    try {
        const result = await roomsCollection.updateOne({ code: code }, { $set: { admin_id: newAdminId } });
        return result.modifiedCount > 0;
    } catch (error) {
        console.error("Error updating admin in MongoDB:", error);
        return false;
    }
}

async function deleteRoom(code) {
    try {
        const result = await roomsCollection.deleteOne({ code: code });
        return result.deletedCount > 0;
    } catch (error) {
        console.error("Error deleting room from MongoDB:", error);
        return false;
    }
}

// --- CORRECTED HELPER FUNCTION FOR ROOM CLEANUP ---
// Now accepts the 'socket' object as its first argument
async function cleanupRoomAndNotify(socket, roomCode, userName, isDisconnected = false) {
    const socketId = socket.id; // Get the socket ID from the passed socket object

    if (!roomCode || !usersInRooms[roomCode] || !userName) {
        console.log(`Skipping cleanup for user ${socketId}: No roomCode or userName.`);
        // Ensure socket properties are cleared even if no room data found
        delete socket.roomCode;
        delete socket.userName;
        return;
    }

    // Ensure the user is actually in the room's users list before deleting
    if (usersInRooms[roomCode][socketId]) {
        delete usersInRooms[roomCode][socketId];
        console.log(`User ${userName} (${socketId}) removed from room ${roomCode}.`);
    } else {
        console.log(`User ${userName} (${socketId}) not found in room ${roomCode}'s list.`);
    }

    try {
        const room = await getRoom(roomCode);
        let currentAdminId = room?.admin_id;
        const remainingUserIds = Object.keys(usersInRooms[roomCode]);
        const numRemainingUsers = remainingUserIds.length;

        if (socketId === currentAdminId) { // If the admin is leaving/disconnecting
            if (numRemainingUsers > 0) {
                currentAdminId = remainingUserIds[0]; // Assign first remaining user as new admin
                await updateAdmin(roomCode, currentAdminId);
                console.log(`Admin for room ${roomCode} reassigned to ${currentAdminId}.`);
            } else {
                // Admin left and no users left, delete room
                await deleteRoom(roomCode);
                delete usersInRooms[roomCode];
                if (messageReactions[roomCode]) {
                    delete messageReactions[roomCode];
                }
                console.log(`Room ${roomCode} deleted due to all users leaving (admin was last).`);
                return; // Room is gone, no more updates needed
            }
        } else { // If a non-admin leaves/disconnects
            if (numRemainingUsers === 0) {
                await deleteRoom(roomCode);
                delete usersInRooms[roomCode];
                if (messageReactions[roomCode]) {
                    delete messageReactions[roomCode];
                }
                console.log(`Room ${roomCode} deleted as last non-admin left.`);
                return; // Room is gone, no more updates needed
            }
        }

        // If the room still exists (not deleted above), send updates to remaining users
        const updatedRoomState = await getRoom(roomCode); // Get latest room state from DB
        const users = Object.entries(usersInRooms[roomCode]).map(([id, userData]) => ({
            id,
            name: userData.name,
            isAdmin: id === updatedRoomState?.admin_id
        }));

        ioServer.to(roomCode).emit('room-users', {
            users: users,
            adminId: updatedRoomState?.admin_id
        });

        ioServer.to(roomCode).emit('chat-message', {
            userName: 'System',
            text: `${userName} ${isDisconnected ? 'disconnected' : 'left'} the chat.`,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            messageId: `sys-${Date.now()}`,
            senderId: 'system'
        });

    } catch (error) {
        console.error("Error during cleanupRoomAndNotify:", error);
    } finally {
        // These properties are on the 'socket' object passed as an argument, so this works now
        delete socket.roomCode;
        delete socket.userName;
    }
}
// --- END CORRECTED HELPER FUNCTION ---


// Socket.IO Event Handlers
ioServer.on('connection', socket => {
    console.log('A user connected:', socket.id);

    socket.on('join-room', async ({ userName, roomCode, password, create }) => {
        const trimmedRoomCode = roomCode.trim();
        const trimmedUserName = userName.trim();
        const trimmedPassword = password ? password.trim() : "";

        if (!trimmedRoomCode || trimmedRoomCode.length > 20) {
            socket.emit('room-error', 'Invalid room code. Please enter a valid code (max 20 characters).');
            return;
        }
        if (!trimmedUserName) {
            socket.emit('room-error', 'Please enter your name.');
            return;
        }
        if (trimmedPassword.length > 30) {
            socket.emit('room-error', 'Invalid password (max 30 characters).');
            return;
        }

        let room = await getRoom(trimmedRoomCode);

        if (!room) {
            if (!create) {
                socket.emit('room-error', 'Room does not exist. Do you want to create it?');
                return;
            }
            if (!trimmedPassword) {
                socket.emit('room-error', 'A password is required to create a new private room.');
                return;
            }
            if (await createRoom(trimmedRoomCode, trimmedPassword, socket.id)) {
                usersInRooms[trimmedRoomCode] = {};
                room = await getRoom(trimmedRoomCode); // Re-fetch the newly created room to get its admin_id
            } else {
                socket.emit('room-error', 'Failed to create the room. It might already exist or there was a database error. Please try again.');
                return;
            }
        } else {
            if (room.password !== trimmedPassword) {
                socket.emit('room-error', 'Incorrect password.');
                return;
            }
        }

        socket.join(trimmedRoomCode);
        socket.userName = trimmedUserName;
        socket.roomCode = trimmedRoomCode;

        if (!usersInRooms[trimmedRoomCode]) usersInRooms[trimmedRoomCode] = {};
        usersInRooms[trimmedRoomCode][socket.id] = { name: trimmedUserName, isAdmin: false };

        const currentRoomState = await getRoom(trimmedRoomCode);

        const users = Object.entries(usersInRooms[trimmedRoomCode]).map(([id, userData]) => ({
            id,
            name: userData.name,
            isAdmin: id === currentRoomState?.admin_id
        }));

        ioServer.to(trimmedRoomCode).emit('room-users', {
            users: users,
            adminId: currentRoomState?.admin_id
        });

        ioServer.to(trimmedRoomCode).emit('chat-message', {
            userName: 'System',
            text: `${trimmedUserName} joined the chat.`,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            messageId: `sys-${Date.now()}`,
            senderId: 'system'
        });
    });

    socket.on('chat-message', ({ roomCode, userName, text, time, messageId }) => {
        ioServer.to(roomCode).emit('chat-message', { userName, text, time, messageId, senderId: socket.id });
    });

    socket.on('react-message', ({ roomCode, messageId, emoji }) => {
        if (!messageReactions[roomCode]) messageReactions[roomCode] = {};
        if (!messageReactions[roomCode][messageId]) messageReactions[roomCode][messageId] = {};

        if (messageReactions[roomCode][messageId][socket.id] === emoji) {
            delete messageReactions[roomCode][messageId][socket.id];
        } else {
            messageReactions[roomCode][messageId][socket.id] = emoji;
        }

        const reactionsSummary = {};
        for (const reactorId in messageReactions[roomCode][messageId]) {
            const reactedEmoji = messageReactions[roomCode][messageId][reactorId];
            reactionsSummary[reactedEmoji] = (reactionsSummary[reactedEmoji] || 0) + 1;
        }

        const reactionsArray = Object.keys(reactionsSummary).map(emoji => ({
            emoji: emoji,
            count: reactionsSummary[emoji]
        }));

        ioServer.to(roomCode).emit('update-reactions', { messageId, reactions: reactionsArray });
    });

    socket.on('edit-message', ({ roomCode, messageId, newText }) => {
        if (messageId.startsWith(socket.id + '_')) {
            ioServer.to(roomCode).emit('edit-message', { messageId, newText });
        }
    });

    socket.on('delete-message', async ({ roomCode, messageId }) => {
        if (!roomCode) return;

        const room = await getRoom(roomCode);
        const isAdmin = room?.admin_id === socket.id;

        if (messageId.startsWith(socket.id + '_') || isAdmin) {
            ioServer.to(roomCode).emit('delete-message', messageId);
            if (messageReactions[roomCode] && messageReactions[roomCode][messageId]) {
                delete messageReactions[roomCode][messageId];
            }
        }
    });

    socket.on('typing', ({ roomCode, userName }) => {
        socket.to(roomCode).emit('user-typing', userName);
    });

    socket.on('stop-typing', (roomCode) => {
        socket.to(roomCode).emit('user-stop-typing');
    });

    socket.on('kick-user', async ({ roomCode, targetId }) => {
        const currentRoom = await getRoom(roomCode);
        if (currentRoom?.admin_id === socket.id) {
            const targetSocket = ioServer.sockets.sockets.get(targetId);
            if (targetSocket && targetSocket.roomCode === roomCode) {
                targetSocket.emit('kicked');
                targetSocket.leave(roomCode);
                // Call cleanup for the kicked user, passing the targetSocket itself
                await cleanupRoomAndNotify(targetSocket, roomCode, targetSocket.userName, false);
            }
        } else {
            socket.emit('room-error', 'Only the room administrator can kick users.');
        }
    });

   socket.on('leave-room', async () => {
    console.log(`User <span class="math-inline">\{socket\.userName\} \(</span>{socket.id}) explicitly leaving room ${socket.roomCode}.`);
    await cleanupRoomAndNotify(socket, socket.roomCode, socket.userName, false);
    // This is the critical line to ensure the client gets the signal to reset
    socket.emit('room-left'); // <--- THIS MUST BE HERE
});

    // Handle user disconnect (browser close, network issue, etc.)
    socket.on('disconnect', async () => {
        console.log(`User ${socket.userName || socket.id} disconnected.`);
        // Pass the socket object itself to cleanupRoomAndNotify
        await cleanupRoomAndNotify(socket, socket.roomCode, socket.userName, true);
    });
});

const PORT = process.env.PORT || 3000;
connectToDatabase().then(() => {
    httpServer.listen(PORT, () => console.log(`Server running on port ${PORT}`));
});
