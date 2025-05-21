const socket = io();

const loginDiv = document.getElementById('login');
const chatDiv = document.getElementById('chat');
const nameInput = document.getElementById('nameInput');
const roomInput = document.getElementById('roomInput');
const joinPasswordInput = document.getElementById('joinPassword');
const createPasswordInput = document.getElementById('createPassword');
const joinRoomBtn = document.getElementById('joinRoomBtn');
const generateRoomBtn = document.getElementById('generateRoomBtn');
const generatedRoomDiv = document.getElementById('generatedRoom');
const newRoomCodeSpan = document.getElementById('newRoomCode');
const copyLinkBtn = document.getElementById('copyLinkBtn');
const roomNameSpan = document.getElementById('roomName');
const usersList = document.getElementById('users');
const messagesContainer = document.getElementById('messages');
const messageInput = document.getElementById('messageInput');
const sendMessageBtn = document.getElementById('sendMessageBtn');
const leaveRoomBtn = document.getElementById('leaveRoomBtn');

let userName = '';
let roomCode = '';
let socketId = '';
let messageIdCounter = 0;
let isAdmin = false;
let typingTimeout;

const showToast = (message, duration = 3000) => {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('show');
    }, 10);
    setTimeout(() => {
        toast.classList.remove('show');
        toast.addEventListener('transitionend', () => toast.remove());
    }, duration);
};

const displayError = (msg) => {
    showToast(msg, 5000);
    console.error('Error:', msg);
};

const handleJoinChat = (create = false) => {
    userName = nameInput.value.trim();
    roomCode = roomInput.value.trim();
    const password = create ? createPasswordInput.value.trim() : joinPasswordInput.value.trim();

    if (!userName) {
        displayError('Please enter your name.');
        return;
    }
    if (!roomCode) {
        displayError('Please enter a room code.');
        return;
    }
    if (roomCode.length > 20) {
        displayError('Room code cannot exceed 20 characters.');
        return;
    }
    if (password.length > 30) {
        displayError('Password cannot exceed 30 characters.');
        return;
    }
    if (create && !password) {
        displayError('A password is required to create a new private room.');
        return;
    }

    socket.emit('join-room', { userName, roomCode, password, create });
};

const handleGenerateRoom = () => {
    const randomCode = Math.random().toString(36).substring(2, 8);
    roomInput.value = randomCode;
    newRoomCodeSpan.textContent = randomCode;
    generatedRoomDiv.style.display = 'block';
    handleJoinChat(true);
};

const handleCopyLink = () => {
    const code = roomInput.value.trim();
    if (!code) {
        displayError("No room code generated to copy.");
        return;
    }
    const url = `${window.location.origin}?room=${code}`;
    navigator.clipboard.writeText(url)
        .then(() => showToast("Invite link copied!"))
        .catch(err => displayError('Failed to copy text. Please copy manually.'));
};

const handleSendMessage = () => {
    const msg = messageInput.value.trim();
    if (msg) {
        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const messageId = `${socketId}_${messageIdCounter++}`;
        socket.emit('chat-message', { roomCode, userName, text: msg, time, messageId });
        messageInput.value = '';
        messageInput.focus();
    }
};

const handleReactMessage = (messageId, emoji) => {
    socket.emit('react-message', { roomCode, messageId, emoji, userName });
};

const handleEditMessage = (messageId) => {
    const msgDiv = messagesContainer.querySelector(`[data-id='${messageId}']`);
    if (!msgDiv) return;
    const span = msgDiv.querySelector('.msg-text');
    const currentText = span.textContent.replace(' (edited)', '');
    const newText = prompt('Edit your message:', currentText);
    if (newText !== null && newText.trim() !== '' && newText.trim() !== currentText.trim()) {
        socket.emit('edit-message', { roomCode, messageId, newText: newText.trim() });
    }
};

const handleDeleteMessage = (messageId) => {
    if (confirm("Delete this message?")) {
        socket.emit('delete-message', { roomCode, messageId });
    }
};

const handleInputTyping = () => {
    socket.emit('typing', { roomCode, userName });
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        socket.emit('stop-typing', roomCode);
    }, 1000);
};

const handleMessageContextMenu = (e, messageId, isMe) => {
    e.preventDefault();
    showActionsMenu(e.pageX, e.pageY, messageId, isMe);
};

const handleMessageTouch = (div) => {
    let pressTimer;
    div.addEventListener('touchstart', () => {
        pressTimer = setTimeout(() => {
            div.classList.toggle('show-actions');
        }, 500);
    }, { passive: true });
    div.addEventListener('touchend', () => clearTimeout(pressTimer));
    div.addEventListener('touchmove', () => clearTimeout(pressTimer));
};

const showActionsMenu = (x, y, messageId, isMe) => {
    let html = `
        <div class="menu-item p-2 hover:bg-gray-100 cursor-pointer" onclick="handleReactMessage('${messageId}', '👍')">👍 React</div>
        <div class="menu-item p-2 hover:bg-gray-100 cursor-pointer" onclick="handleReactMessage('${messageId}', '❤️')">❤️ React</div>
        <div class="menu-item p-2 hover:bg-gray-100 cursor-pointer" onclick="handleReactMessage('${messageId}', '😂')">😂 React</div>
    `;
    if (isMe) {
        html += `
            <div class="menu-item p-2 hover:bg-gray-100 cursor-pointer" onclick="handleEditMessage('${messageId}')">✏️ Edit</div>
            <div class="menu-item p-2 hover:bg-gray-100 cursor-pointer" onclick="handleDeleteMessage('${messageId}')">🗑️ Delete</div>
        `;
    }
    actionMenu.innerHTML = html;
    actionMenu.style.left = `${x}px`;
    actionMenu.style.top = `${y}px`;
    actionMenu.style.display = 'block';
};

const appendMessage = ({ userName: sender, text, time, messageId, senderId }) => {
    const div = document.createElement('div');
    const isMe = (sender === userName && senderId === socketId);

    div.className = isMe ? 'message me' : 'message';
    div.dataset.id = messageId;

    const html = `
        <strong>${sender}</strong><br>
        <span class="msg-text">${text}</span>
        <br><span class="time">${time}</span>
        <div class="actions">
            <button class="action-btn" data-emoji="👍">👍</button>
            <button class="action-btn" data-emoji="❤️">❤️</button>
            <button class="action-btn" data-emoji="😂">😂</button>
            ${isMe ? `
                <button class="edit-btn">✏️</button>
                <button class="delete-btn">🗑️</button>
            ` : ''}
        </div>
        <div class="reactions" id="react-${messageId}"></div>
    `;
    div.innerHTML = html;

    div.addEventListener('contextmenu', (e) => handleMessageContextMenu(e, messageId, isMe));
    handleMessageTouch(div);

    div.querySelectorAll('.action-btn').forEach(button => {
        button.addEventListener('click', () => handleReactMessage(messageId, button.dataset.emoji));
    });
    if (isMe) {
        div.querySelector('.edit-btn')?.addEventListener('click', () => handleEditMessage(messageId));
        div.querySelector('.delete-btn')?.addEventListener('click', () => handleDeleteMessage(messageId));
    }

    messagesContainer.appendChild(div);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    if (!isMe && Notification.permission === "granted") {
        new Notification(`${sender} says:`, { body: text });
    }
};

const updateReactionDisplay = (messageId, reactions) => {
    const container = document.getElementById(`react-${messageId}`);
    if (container) {
        container.textContent = reactions.map(r => `${r.emoji} ${r.count}`).join(' ');
    }
};

const updateMessageText = (messageId, newText) => {
    const span = messagesContainer.querySelector(`[data-id='${messageId}'] .msg-text`);
    if (span) span.textContent = newText + ' (edited)';
};

const removeMessageElement = (messageId) => {
    const msg = messagesContainer.querySelector(`[data-id='${messageId}']`);
    if (msg) msg.remove();
};

const updateUsersList = (users, adminId) => {
    usersList.innerHTML = '';
    isAdmin = socketId === adminId;

    users.forEach(u => {
        const li = document.createElement('li');
        li.textContent = u.name + (u.isAdmin ? ' 👑' : '');
        if (isAdmin && !u.isAdmin && u.id !== socketId) {
            const btn = document.createElement('button');
            btn.textContent = 'Kick';
            btn.className = 'kick-button px-2 py-1 ml-2 text-sm bg-red-500 text-white rounded hover:bg-red-600 transition';
            btn.addEventListener('click', () => {
                if (confirm(`Are you sure you want to kick ${u.name}?`)) {
                    socket.emit('kick-user', { roomCode, targetId: u.id });
                }
            });
            li.appendChild(btn);
        }
        usersList.appendChild(li);
    });

    loginDiv.style.display = 'none';
    chatDiv.style.display = 'flex';
    roomNameSpan.textContent = roomCode;
};

const handleLeaveRoom = () => {
    if (confirm("Are you sure you want to leave this room?")) {
        socket.emit('leave-room'); // No data needed, server has socket.id, roomCode, userName
    }
};

window.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const roomFromURL = urlParams.get('room');
    if (roomFromURL) {
        roomInput.value = roomFromURL;
        loginDiv.scrollIntoView({ behavior: 'smooth' });
    }

    joinRoomBtn.addEventListener('click', () => handleJoinChat(false));
    generateRoomBtn.addEventListener('click', handleGenerateRoom);
    copyLinkBtn.addEventListener('click', handleCopyLink);
    sendMessageBtn.addEventListener('click', handleSendMessage);
    messageInput.addEventListener('input', handleInputTyping);
     leaveRoomBtn.addEventListener('click', handleLeaveRoom);
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            handleSendMessage();
        }
    });

    document.addEventListener('click', (e) => {
        if (actionMenu.style.display === 'block' && !actionMenu.contains(e.target)) {
            actionMenu.style.display = 'none';
        }
        document.querySelectorAll('.message.show-actions').forEach(msg => {
            if (!msg.contains(e.target)) msg.classList.remove('show-actions');
        });
    });

    if ('Notification' in window && Notification.permission !== 'granted' && Notification.permission !== 'denied') {
        Notification.requestPermission();
    }
});

const typingIndicator = document.createElement('div');
typingIndicator.id = 'typingIndicator';
messagesContainer.after(typingIndicator);

const actionMenu = document.createElement('div');
actionMenu.id = 'actionMenu';
Object.assign(actionMenu.style, {
    position: 'absolute',
    display: 'none',
    zIndex: 1000,
    background: '#fff',
    border: '1px solid #ccc',
    borderRadius: '6px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
});
document.body.appendChild(actionMenu);


socket.on('connect', () => {
    socketId = socket.id;
});

socket.on('room-error', (msg) => {
    displayError(msg);
});

socket.on('room-users', ({ users, adminId }) => {
    updateUsersList(users, adminId);
});

socket.on('chat-message', (data) => {
    appendMessage(data);
});

socket.on('update-reactions', ({ messageId, reactions }) => {
    updateReactionDisplay(messageId, reactions);
});

socket.on('edit-message', ({ messageId, newText }) => {
    updateMessageText(messageId, newText);
});

socket.on('delete-message', (messageId) => {
    removeMessageElement(messageId);
});

socket.on('user-typing', (name) => {
    typingIndicator.textContent = `${name} is typing...`;
});

socket.on('user-stop-typing', () => {
    typingIndicator.textContent = '';
});

socket.on('kicked', () => {
    showToast("You were kicked from the room.", 5000);
    setTimeout(() => location.reload(), 1000);
});

// In script.js
socket.on('room-left', () => {
    showToast("You have left the room.");

    // Add a delay of, for example, 1000 milliseconds (1 second)
    setTimeout(() => {
        location.reload();
    }, 2000); // The 1000 here is the delay in milliseconds
});
