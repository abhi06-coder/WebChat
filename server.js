const express = require('express');
const http = require('http').createServer(express()); // FIX: This is still wrong
const io = require('socket.io')(http);
const path = require('path');
const { MongoClient } = require('mongodb');

// CORRECTED EXPRESS/HTTP/SOCKET.IO SETUP:
// 1. Create the Express application instance FIRST
const app = express();

// 2. Then, create the HTTP server using that 'app' instance
// This is the CRITICAL FIX for "Cannot GET /"
const httpServer = require('http').createServer(app); // Renamed to httpServer for clarity

// 3. Attach Socket.IO to the 'httpServer'
const ioServer = require('socket.io')(httpServer); // Renamed to ioServer for clarity

// --- MongoDB Connection Setup ---
// IMPORTANT: Replace this placeholder with your actual, URL-encoded connection string.
// Also, set this as an environment variable named MONGODB_URI on Render.
const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://abhi:<db_password>@webchat.1vvhscv.mongodb.net/?retryWrites=true&w=majority&appName=webchat"

const client = new MongoClient(MONGODB_URI);
let roomsCollection; // This will hold our reference to the 'rooms' collection

async function connectToDatabase() {
    try {
        await client.connect();
        console.log("Connected to MongoDB Atlas!");
        const db = client.db('chatdb'); // Specify your database name (e.g., 'chatdb')
        roomsCollection = db.collection('rooms'); // Specify your collection name for rooms

        // Optional: Create a unique index on 'code' to prevent duplicate room codes
        // This helps handle concurrent room creation attempts gracefully.
        await roomsCollection.createIndex({ code: 1 }, { unique: true }).catch(err => {
            if (err.code !== 48) { // 48 is "Index already exists"
                console.warn("Could not create unique index on rooms.code:", err.message);
            }
        });

    } catch (error) {
        console.error("MongoDB connection error:", error);
        // Exit the process if we can't connect to the database, as the app won't function
        process.exit(1);
    }
}
// -----------------------------------------------------------

// Configure Express to serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Define the route for the root URL to send your index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// In-memory storage for active users and reactions (these are NOT persistent across server restarts)
const messageReactions = {}; // Stores reactions for active messages
const usersInRooms = {};    // Stores who is currently in which room

// --- Database Functions ---
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
        console.log(`Room created in MongoDB: ${code}`);
        return true;
    } catch (error) {
        if (error.code === 11000) { // Duplicate key error
            console.warn(`Attempted to create duplicate room code: ${code}`);
            return false;
        }
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
// -----------------------------------------------------------


// Socket.IO event handlers
ioServer.on('connection', socket => { // Use ioServer here
    console.log('A user connected:', socket.id);

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
        password = password ? password.trim() : ""; // Ensure password is trimmed or empty string

        const room = await getRoom(roomCode); // Uses MongoDB getRoom

        if (!room) {
            if (!create) {
                socket.emit('room-error', 'Room does not exist. Do you want to create it?');
                return;
            }
            if (!password) {
                socket.emit('room-error', 'A password is required to create a new private room.');
                return;
            }
            if (await createRoom(roomCode, password, socket.id)) { // Uses MongoDB createRoom
                usersInRooms[roomCode] = {};
            } else {
                socket.emit('room-error', 'Failed to create the room (room might already exist or DB error). Please try again.');
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
        usersInRooms[roomCode][socket.id] = { name: userName, isAdmin: false }; // Store user data including isAdmin initially as false

        // Update admin status for the joining user if they are the admin
        if (room?.admin_id === socket.id || create) { // If joining existing room as admin or creating, set isAdmin
            usersInRooms[roomCode][socket.id].isAdmin = true;
            if (create && !room) { // If we just created the room, ensure DB has this admin
                 await updateAdmin(roomCode, socket.id); // This will update it in DB
            }
        }


        try {
            // Fetch the room again to ensure we have the very latest admin_id from the DB
            const currentRoomState = await getRoom(roomCode);

            // Construct the list of users with correct admin status
            const users = Object.entries(usersInRooms[roomCode]).map(([id, userData]) => ({
                id,
                name: userData.name,
                isAdmin: id === currentRoomState?.admin_id
            }));

            ioServer.to(roomCode).emit('room-users', { // Use ioServer here
                users: users,
                adminId: currentRoomState?.admin_id
            });

            ioServer.to(roomCode).emit('chat-message', { // Use ioServer here
                userName: 'System',
                text: `${userName} joined the chat.`,
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                messageId: `sys-${Date.now()}`,
                senderId: 'system'
            });
        } catch (error) {
            console.error("Error during post-join actions (MongoDB context):", error);
            socket.emit('room-error', 'An error occurred after joining. Please try again.');
        }
    });

    socket.on('chat-message', ({ roomCode, userName, text, time, messageId }) => {
        ioServer.to(roomCode).emit('chat-message', { userName, text, time, messageId, senderId: socket.id }); // Use ioServer here
    });

    socket.on('react-message', ({ roomCode, messageId, emoji, userName }) => {
        if (!messageReactions[roomCode]) messageReactions[roomCode] = {};
        if (!messageReactions[roomCode][messageId]) messageReactions[roomCode][messageId] = {};

        // Simple toggle for reactions by a user
        if (messageReactions[roomCode][messageId][socket.id] === emoji) {
            delete messageReactions[roomCode][messageId][socket.id]; // Remove reaction if already present
        } else {
            messageReactions[roomCode][messageId][socket.id] = emoji; // Set or change reaction
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

        ioServer.to(roomCode).emit('update-reactions', { messageId, reactions: reactionsArray }); // Use ioServer here
    });


    socket.on('edit-message', ({ roomCode, messageId, newText }) => {
        // Basic authorization: ensure only the sender can edit their own message
        // In a real app, you'd store senderId with the message permanently.
        if (messageId.startsWith(socket.id + '_')) { // Checks if messageId was generated by this socket
            ioServer.to(roomCode).emit('edit-message', { messageId, newText }); // Use ioServer here
        }
    });

    socket.on('delete-message', async (messageId) => {
        const roomCode = socket.roomCode;
        if (!roomCode) return;

        // In a real app, you'd fetch the message from DB and check senderId/admin status.
        const isAdmin = (await getRoom(roomCode))?.admin_id === socket.id;

        if (messageId.startsWith(socket.id + '_') || isAdmin) { // Only sender or admin can delete
            ioServer.to(roomCode).emit('delete-message', messageId); // Use ioServer here
            // Clean up reactions for the deleted message
            if (messageReactions[roomCode] && messageReactions[roomCode][messageId]) {
                delete messageReactions[roomCode][messageId];
            }
        }
    });

    socket.on('typing', ({ roomCode, userName }) => {
        socket.to(roomCode).emit('user-typing', userName); // Use socket.to to send to others in room
    });

    socket.on('stop-typing', (roomCode) => {
        socket.to(roomCode).emit('user-stop-typing'); // Use socket.to
    });

    socket.on('kick-user', async ({ roomCode, targetId }) => {
        const currentRoom = await getRoom(roomCode); // Get room state from DB
        if (currentRoom?.admin_id === socket.id) { // Only admin can kick
            const targetSocket = ioServer.sockets.sockets.get(targetId); // Use ioServer here
            if (targetSocket && targetSocket.roomCode === roomCode) {
                targetSocket.emit('kicked');
                targetSocket.leave(roomCode);
                delete usersInRooms[roomCode][targetId];

                // Update users list for remaining members
                const updatedUsers = Object.entries(usersInRooms[roomCode]).map(([id, userData]) => ({
                    id,
                    name: userData.name,
                    isAdmin: id === currentRoom.admin_id
                }));
                ioServer.to(roomCode).emit('room-users', { users: updatedUsers, adminId: currentRoom.admin_id }); // Use ioServer here
                ioServer.to(roomCode).emit('chat-message', { // Use ioServer here
                    userName: 'System',
                    text: `${targetSocket.userName} was kicked from the chat.`,
                    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                    messageId: `sys-${Date.now()}`,
                    senderId: 'system'
                });
            }
        } else {
            socket.emit('room-error', 'Only the room administrator can kick users.');
        }
    });


    socket.on('disconnect', async () => {
        console.log('A user disconnected:', socket.id);
        const roomCode = socket.roomCode;
        if (!roomCode || !usersInRooms[roomCode] || !socket.userName) return;

        const userName = socket.userName;

        delete usersInRooms[roomCode][socket.id];

        try {
            const room = await getRoom(roomCode); // Uses MongoDB getRoom
            let newAdminId = room?.admin_id;

            if (socket.id === room?.admin_id) { // If the admin is leaving
                const remainingUserIds = Object.keys(usersInRooms[roomCode]);
                if (remainingUserIds.length > 0) {
                    newAdminId = remainingUserIds[0]; // Assign first remaining user as new admin
                    await updateAdmin(roomCode, newAdminId); // Update in DB
                } else {
                    // No users left, delete room
                    await deleteRoom(roomCode); // Uses MongoDB deleteRoom
                    delete usersInRooms[roomCode];
                    delete messageReactions[roomCode]; // Clean up reactions for the room
                    console.log(`Room ${roomCode} deleted due to all users leaving.`);
                    return; // Room is gone, no more updates needed
                }
            }

            // After potential admin change, update room-users for remaining
            const currentRoomState = await getRoom(roomCode); // Get latest room state from DB
            const users = Object.entries(usersInRooms[roomCode]).map(([id, userData]) => ({
                id,
                name: userData.name,
                isAdmin: id === currentRoomState?.admin_id // Use updated adminId from DB
            }));

            ioServer.to(roomCode).emit('room-users', { // Use ioServer here
                users: users,
                adminId: currentRoomState?.admin_id
            });

            ioServer.to(roomCode).emit('chat-message', { // Use ioServer here
                userName: 'System',
                text: `${userName} left the chat.`,
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                messageId: `sys-${Date.now()}`,
                senderId: 'system'
            });

        } catch (error) {
            console.error("Error during disconnect (MongoDB context):", error);
        } finally {
            // Clean up socket properties regardless of DB outcome
            delete socket.roomCode;
            delete socket.userName;
        }
    });
});

// Start the server ONLY AFTER successfully connecting to the database
const PORT = process.env.PORT || 3000;
connectToDatabase().then(() => {
    httpServer.listen(PORT, () => console.log(`Server running on port ${PORT}`)); // Use httpServer here
});
