const socket = io();
let userName = '';
let roomCode = '';
let socketId = '';
let messageIdCounter = 0;
let isAdmin = false;

window.onload = () => {
    const urlParams = new URLSearchParams(window.location.search);
    const roomFromURL = urlParams.get('room');
    if (roomFromURL) {
        document.getElementById('roomInput').value = roomFromURL;
        // Make sure 'joinSection' actually exists in your HTML if you want to scroll to it.
        // Based on your index.html, there's no element with id 'joinSection'.
        // The relevant section is the 'login' div.
        const loginDiv = document.getElementById('login');
        if (loginDiv) {
            loginDiv.scrollIntoView({ behavior: 'smooth' });
        }
    }
};

function joinChat(create = false) {
    userName = document.getElementById('nameInput').value.trim();
    roomCode = document.getElementById('roomInput').value.trim();
    const password = create
        ? document.getElementById('createPassword').value.trim() // Trim password too
        : document.getElementById('joinPassword').value.trim(); // Trim password too

    // Client-side validation before sending to server (optional but good for UX)
    if (!userName) {
        alert('Please enter your name.');
        return;
    }
    if (!roomCode) {
        alert('Please enter a room code.');
        return;
    }
    if (roomCode.length > 20) {
        alert('Room code cannot exceed 20 characters.');
        return;
    }
    if (password.length > 30) {
        alert('Password cannot exceed 30 characters.');
        return;
    }
    if (create && !password) {
        alert('A password is required to create a new private room.');
        return;
    }


    // Emit to server if all client-side checks pass
    socket.emit('join-room', { userName, roomCode, password, create });
}

function generateRoom() {
    const randomCode = Math.random().toString(36).substring(2, 8);
    document.getElementById('roomInput').value = randomCode;
    document.getElementById('newRoomCode').textContent = randomCode;
    document.getElementById('generatedRoom').style.display = 'block';
    joinChat(true); // Call joinChat to attempt to create/join the generated room
}

function copyLink() {
    const code = document.getElementById('roomInput').value.trim();
    if (!code) { // Ensure there's a code to copy
        alert("No room code generated to copy.");
        return;
    }
    const url = `${window.location.origin}?room=${code}`;
    navigator.clipboard.writeText(url)
        .then(() => alert("Invite link copied!"))
        .catch(err => console.error('Failed to copy text: ', err)); // Better error handling for copy
}

socket.on('connect', () => {
    socketId = socket.id;
    console.log('Connected to server with socket ID:', socketId); // Log connection
});

// Centralized error display for room-related errors
socket.on('room-error', msg => {
    alert(msg);
    console.error('Room Error:', msg); // Log error for debugging
});

socket.on('room-users', ({ users, adminId }) => {
    const userList = document.getElementById('users');
    userList.innerHTML = '';
    isAdmin = socketId === adminId;

    users.forEach(u => {
        const li = document.createElement('li');
        li.textContent = u.name + (u.isAdmin ? ' 👑' : '');
        if (isAdmin && !u.isAdmin && u.id !== socketId) {
            const btn = document.createElement('button');
            btn.textContent = 'Kick';
            btn.className = 'kick-button'; // Add a class for styling if needed
            btn.onclick = () => {
                if (confirm(`Are you sure you want to kick ${u.name}?`)) { // Confirmation
                    socket.emit('kick-user', { roomCode, targetId: u.id });
                }
            };
            li.appendChild(btn);
        }
        userList.appendChild(li);
    });

    document.getElementById('login').style.display = 'none';
    document.getElementById('chat').style.display = 'block';
    document.getElementById('roomName').textContent = roomCode;
});

function sendMessage() {
    const input = document.getElementById('messageInput');
    const msg = input.value.trim();
    if (msg) {
        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const messageId = `${socketId}_${messageIdCounter++}`;
        socket.emit('chat-message', { roomCode, userName, text: msg, time, messageId });
        input.value = '';
        input.focus();
    }
}

socket.on('chat-message', ({ userName: sender, text, time, messageId, senderId }) => {
    const messages = document.getElementById('messages');
    const div = document.createElement('div');
    const isMe = (sender === userName && senderId === socketId); // More robust 'isMe' check

    div.className = isMe ? 'message me' : 'message';
    div.dataset.id = messageId;

    const html = `
        <strong>${sender}</strong><br>
        <span class="msg-text">${text}</span>
        <br><span class="time">${time}</span>
        <div class="actions">
            <button onclick="react('${messageId}', '👍')">👍</button>
            <button onclick="react('${messageId}', '❤️')">❤️</button>
            <button onclick="react('${messageId}', '😂')">😂</button>
            ${isMe ? `
                <button onclick="editMessage('${messageId}')">✏️</button>
                <button onclick="deleteMessage('${messageId}')">🗑️</button>
            ` : ''}
        </div>
        <div class="reactions" id="react-${messageId}"></div>
    `;
    div.innerHTML = html;

    div.addEventListener('contextmenu', e => {
        e.preventDefault();
        showActionsMenu(e.pageX, e.pageY, messageId, isMe);
    });

    let pressTimer;
    div.addEventListener('touchstart', () => {
        pressTimer = setTimeout(() => {
            div.classList.toggle('show-actions');
        }, 500);
    }, { passive: true }); // Added { passive: true } for better scroll performance on mobile
    div.addEventListener('touchend', () => clearTimeout(pressTimer));
    div.addEventListener('touchmove', () => clearTimeout(pressTimer));

    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;

    // Request Notification permission if not already granted and notify
    if (!isMe && Notification.permission === "granted") {
        new Notification(`${sender} says:`, { body: text });
    }
});

function react(messageId, emoji) {
    socket.emit('react-message', { roomCode, messageId, emoji, userName });
}

socket.on('update-reactions', ({ messageId, reactions }) => {
    const container = document.getElementById(`react-${messageId}`);
    if (container) {
        container.textContent = reactions.map(r => `${r.emoji} ${r.count}`).join(' '); // Simpler display
    }
});

function editMessage(messageId) {
    const msgDiv = document.querySelector(`[data-id='${messageId}']`);
    if (!msgDiv) return;
    const span = msgDiv.querySelector('.msg-text');
    const currentText = span.textContent.replace(' (edited)', ''); // Remove ' (edited)' if present
    const newText = prompt('Edit your message:', currentText);
    if (newText !== null && newText.trim() !== '' && newText.trim() !== currentText.trim()) { // Check for actual change
        socket.emit('edit-message', { roomCode, messageId, newText: newText.trim() });
    }
}

function deleteMessage(messageId) {
    if (confirm("Delete this message?")) {
        socket.emit('delete-message', { roomCode, messageId });
    }
}

socket.on('edit-message', ({ messageId, newText }) => {
    const span = document.querySelector(`[data-id='${messageId}'] .msg-text`);
    if (span) span.textContent = newText + ' (edited)';
});

socket.on('delete-message', (messageId) => {
    const msg = document.querySelector(`[data-id='${messageId}']`);
    if (msg) msg.remove();
});

const typingText = document.createElement('div');
typingText.id = 'typing';
// Check if 'messages' element exists before trying to append after it
const messagesContainer = document.getElementById('messages');
if (messagesContainer) {
    messagesContainer.after(typingText);
} else {
    console.warn("Messages container not found. Typing indicator might not appear.");
}


let typingTimeout;
const messageInput = document.getElementById('messageInput');
if (messageInput) { // Ensure messageInput exists before adding listener
    messageInput.addEventListener('input', () => {
        socket.emit('typing', { roomCode, userName });
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
            socket.emit('stop-typing', roomCode);
        }, 1000);
    });
} else {
    console.warn("Message input not found. Typing indicator will not function.");
}


socket.on('user-typing', (name) => {
    if (typingText) { // Ensure typingText element exists
        typingText.textContent = `${name} is typing...`;
    }
});

socket.on('user-stop-typing', () => {
    if (typingText) { // Ensure typingText element exists
        typingText.textContent = '';
    }
});

socket.on('kicked', () => {
    alert("You were kicked from the room.");
    location.reload(); // Reload the page to reset the state
});

const actionMenu = document.createElement('div');
actionMenu.id = 'actionMenu';
Object.assign(actionMenu.style, {
    position: 'absolute',
    display: 'none',
    zIndex: 1000,
    background: '#fff',
    border: '1px solid #ccc',
    borderRadius: '6px',
    padding: '5px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
});
document.body.appendChild(actionMenu);

function showActionsMenu(x, y, messageId, isMe) {
    let html = `
        <div class="menu-item" onclick="react('${messageId}', '👍')">👍 React</div>
        <div class="menu-item" onclick="react('${messageId}', '❤️')">❤️ React</div>
        <div class="menu-item" onclick="react('${messageId}', '😂')">😂 React</div>
    `;
    if (isMe) {
        html += `
            <div class="menu-item" onclick="editMessage('${messageId}')">✏️ Edit</div>
            <div class="menu-item" onclick="deleteMessage('${messageId}')">🗑️ Delete</div>
        `;
    }
    actionMenu.innerHTML = html;
    actionMenu.style.left = `${x}px`;
    actionMenu.style.top = `${y}px`;
    actionMenu.style.display = 'block';
}

document.addEventListener('click', (e) => {
    // Hide action menu if clicked outside
    if (actionMenu.style.display === 'block' && !actionMenu.contains(e.target)) {
        actionMenu.style.display = 'none';
    }

    // Hide mobile actions if clicked outside the message
    document.querySelectorAll('.message.show-actions').forEach(msg => {
        if (!msg.contains(e.target)) msg.classList.remove('show-actions');
    });
});

// Request notification permission on page load if not already granted
if ('Notification' in window) {
    if (Notification.permission !== 'granted' && Notification.permission !== 'denied') {
        Notification.requestPermission().then(permission => {
            if (permission === 'granted') {
                console.log('Notification permission granted.');
            } else {
                console.warn('Notification permission denied.');
            }
        });
    }
} else {
    console.warn('Notifications not supported in this browser.');
}
