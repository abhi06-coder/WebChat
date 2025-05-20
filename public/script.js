const loginSection = document.getElementById('login-section');
const chatSection = document.getElementById('chat-section');
const nameInput = document.getElementById('nameInput');
const roomInput = document.getElementById('roomInput');
const joinPasswordInput = document.getElementById('joinPassword');
const createPasswordInput = document.getElementById('createPassword');
const newRoomCodeSpan = document.getElementById('newRoomCode');
const generatedRoomDiv = document.getElementById('generatedRoom');
const roomNameSpan = document.getElementById('roomName');
const usersList = document.getElementById('users');
const messagesDiv = document.getElementById('messages');
const messageInput = document.getElementById('messageInput');
const typingIndicator = document.getElementById('typing-indicator');

// Removed: loadingOverlay, errorOverlay, errorMessageP, confirmLeaveOverlay, kickUserModal, kickUsernameDisplay, confirmKickBtn

const socket = io();

let currentRoomCode = '';
let currentUserName = '';
let currentAdminId = '';
let isTyping = false;
let typingTimeout;

// Removed: showLoading, hideLoading, showError, hideError, showConfirmLeaveModal, cancelLeave, showKickModal, hideKickModal

window.joinChat = function(create) {
    const userName = nameInput.value.trim();
    const roomCode = roomInput.value.trim();
    const password = create ? createPasswordInput.value : joinPasswordInput.value;

    if (!userName) {
        alert('Please enter your name.'); // Changed from showError
        return;
    }
    if (!roomCode && !create) {
        alert('Please enter a room code.'); // Changed from showError
        return;
    }
    if (create && !password) {
        alert('A password is required to create a new room.'); // Changed from showError
        return;
    }

    // Removed showLoading();

    socket.emit('join-room', { userName, roomCode, password, create });
};

window.generateRoom = function() {
    const password = createPasswordInput.value;
    if (!password) {
        alert('Please set a password for the new room.'); // Changed from showError
        return;
    }

    const newRoomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    roomInput.value = newRoomCode;
    newRoomCodeSpan.textContent = newRoomCode;
    generatedRoomDiv.classList.remove('hidden');
};

window.joinGeneratedRoom = function() {
    const userName = nameInput.value.trim();
    const roomCode = newRoomCodeSpan.textContent;
    const password = createPasswordInput.value;

    if (!userName) {
        alert('Please enter your name before joining the generated room.'); // Changed from showError
        return;
    }
    if (!password) {
        alert('Please set a password for the new room before joining.'); // Changed from showError
        return;
    }

    roomInput.value = roomCode;
    joinPasswordInput.value = password;

    joinChat(true);
};

window.copyLink = function() {
    const roomCode = newRoomCodeSpan.textContent;
    const inviteLink = `${window.location.origin}?room=${roomCode}`;
    navigator.clipboard.writeText(inviteLink).then(() => {
        alert('Invite link copied to clipboard!');
    }).catch(err => {
        console.error('Failed to copy: ', err);
        alert('Failed to copy link. Please copy manually: ' + inviteLink); // Changed from showError
    });
};

window.sendMessage = function() {
    const text = messageInput.value.trim();
    if (text) {
        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const messageId = socket.id + '_' + Date.now();
        socket.emit('chat-message', { roomCode: currentRoomCode, userName: currentUserName, text, time, messageId });
        messageInput.value = '';
        stopTyping();
    }
};

window.confirmLeaveRoom = function() {
    // Reverted to simple confirm dialog
    if (confirm("Are you sure you want to leave this room?")) {
        leaveRoom();
    }
};

window.leaveRoom = function() {
    socket.disconnect();
    chatSection.classList.add('hidden');
    loginSection.classList.remove('hidden');
    messagesDiv.innerHTML = '';
    usersList.innerHTML = '';
    roomNameSpan.textContent = '';
    messageInput.value = '';
    currentRoomCode = '';
    currentUserName = '';
    currentAdminId = '';
    // Removed hideConfirmLeaveModal();
    // Removed hideLoading();
    // Removed hideError();
    location.reload();
};

socket.on('connect', () => {
    console.log('Connected to server with ID:', socket.id);
    // Removed hideLoading();
});

socket.on('room-error', (message) => {
    // Removed hideLoading();
    alert(message); // Changed from showError
    console.error('Room Error:', message); // Log error for debugging
});

socket.on('room-joined', ({ roomCode, userName }) => {
    console.log('DEBUG: room-joined event received!'); // New log
    console.log('DEBUG: Current roomCode:', roomCode, 'userName:', userName); // New log

    currentRoomCode = roomCode;
    currentUserName = userName;
    roomNameSpan.textContent = roomCode;

    console.log('DEBUG: Before classList operations.'); // New log
    console.log('DEBUG: loginSection element:', loginSection); // New log: Check if it's null/undefined
    console.log('DEBUG: chatSection element:', chatSection);   // New log: Check if it's null/undefined

    loginSection.classList.add('hidden');
    chatSection.classList.remove('hidden');

    console.log('DEBUG: After classList operations.'); // New log
    console.log('DEBUG: loginSection now has hidden?', loginSection.classList.contains('hidden')); // New log
    console.log('DEBUG: chatSection now has hidden?', chatSection.classList.contains('hidden'));   // New log

    messageInput.focus();

    console.log('DEBUG: UI transition complete attempt.'); // New log
});socket.on('room-joined', ({ roomCode, userName }) => {
    console.log('DEBUG: room-joined event received!'); // New log
    console.log('DEBUG: Current roomCode:', roomCode, 'userName:', userName); // New log

    currentRoomCode = roomCode;
    currentUserName = userName;
    roomNameSpan.textContent = roomCode;

    console.log('DEBUG: Before classList operations.'); // New log
    console.log('DEBUG: loginSection element:', loginSection); // New log: Check if it's null/undefined
    console.log('DEBUG: chatSection element:', chatSection);   // New log: Check if it's null/undefined

    loginSection.classList.add('hidden');
    chatSection.classList.remove('hidden');

    console.log('DEBUG: After classList operations.'); // New log
    console.log('DEBUG: loginSection now has hidden?', loginSection.classList.contains('hidden')); // New log
    console.log('DEBUG: chatSection now has hidden?', chatSection.classList.contains('hidden'));   // New log

    messageInput.focus();

    console.log('DEBUG: UI transition complete attempt.'); // New log
});

socket.on('room-users', ({ users, adminId }) => {
    usersList.innerHTML = '';
    currentAdminId = adminId;

    users.forEach(user => {
        const li = document.createElement('li');
        li.innerHTML = `<i class="fas fa-user user-icon"></i> ${user.name}`;
        if (user.isAdmin) {
            li.innerHTML += ' <span class="admin-badge">Admin</span>';
        }
        if (socket.id === currentAdminId && user.id !== socket.id) {
            const kickBtn = document.createElement('button');
            kickBtn.classList.add('kick-button');
            kickBtn.innerHTML = '<i class="fas fa-times-circle"></i> Kick';
            kickBtn.onclick = () => {
                // Reverted to simple confirm dialog
                if (confirm(`Are you sure you want to kick ${user.name}?`)) {
                    socket.emit('kick-user', { roomCode: currentRoomCode, targetId: user.id });
                }
            };
            li.appendChild(kickBtn);
        }
        usersList.appendChild(li);
    });

    if (window.innerWidth <= 768) {
        usersList.parentElement.classList.add('hidden');
    }
});

socket.on('chat-message', (data) => {
    const messageElement = document.createElement('div');
    messageElement.classList.add('message');
    messageElement.dataset.messageId = data.messageId;

    if (data.senderId === socket.id) {
        messageElement.classList.add('sent');
    } else {
        messageElement.classList.add('received');
    }

    if (data.userName === 'System') {
        messageElement.classList.add('system');
        messageElement.innerHTML = `<span class="message-text">${data.text}</span>
                                     <span class="message-info">${data.time}</span>`;
    } else {
        messageElement.innerHTML = `<span class="sender-name">${data.userName}</span>
                                     <span class="message-text">${data.text}</span>
                                     <span class="message-info">${data.time}</span>`;

        const optionsDiv = document.createElement('div');
        optionsDiv.classList.add('message-options');

        const reactBtn = document.createElement('button');
        reactBtn.innerHTML = '<i class="far fa-smile"></i>';
        reactBtn.title = 'React';
        reactBtn.onclick = () => showReactionPicker(data.messageId, reactBtn);
        optionsDiv.appendChild(reactBtn);

        if (data.senderId === socket.id) {
            const editBtn = document.createElement('button');
            editBtn.innerHTML = '<i class="fas fa-edit"></i>';
            editBtn.title = 'Edit';
            editBtn.onclick = () => editMessage(data.messageId, data.text);
            optionsDiv.appendChild(editBtn);
        }

        if (data.senderId === socket.id || socket.id === currentAdminId) {
            const deleteBtn = document.createElement('button');
            deleteBtn.innerHTML = '<i class="fas fa-trash-alt"></i>';
            deleteBtn.title = 'Delete';
            deleteBtn.onclick = () => deleteMessage(data.messageId);
            optionsDiv.appendChild(deleteBtn);
        }

        messageElement.appendChild(optionsDiv);
    }
    messagesDiv.appendChild(messageElement);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;

    if (!messageElement.classList.contains('sent') && Notification.permission === "granted") {
        new Notification(`${data.userName} says:`, { body: data.text });
    }
});

socket.on('update-reactions', ({ messageId, reactions }) => {
    const messageElement = messagesDiv.querySelector(`[data-message-id="${messageId}"]`);
    if (messageElement) {
        let reactionsContainer = messageElement.querySelector('.reactions-container');
        if (!reactionsContainer) {
            reactionsContainer = document.createElement('div');
            reactionsContainer.classList.add('reactions-container');
            messageElement.appendChild(reactionsContainer);
        }
        reactionsContainer.innerHTML = '';

        reactions.forEach(reaction => {
            if (reaction.count > 0) {
                const bubble = document.createElement('span');
                bubble.classList.add('reaction-bubble');
                bubble.textContent = `${reaction.emoji} ${reaction.count}`;
                bubble.onclick = () => reactToMessage(messageId, reaction.emoji);
                reactionsContainer.appendChild(bubble);
            }
        });
    }
});

socket.on('edit-message', ({ messageId, newText }) => {
    const messageElement = messagesDiv.querySelector(`[data-message-id="${messageId}"]`);
    if (messageElement) {
        const messageTextSpan = messageElement.querySelector('.message-text');
        if (messageTextSpan) {
            messageTextSpan.textContent = newText;
        }
    }
});

socket.on('delete-message', (messageId) => {
    const messageElement = messagesDiv.querySelector(`[data-message-id="${messageId}"]`);
    if (messageElement) {
        messageElement.remove();
    }
});

socket.on('user-typing', (userName) => {
    typingIndicator.textContent = `${userName} is typing...`;
    typingIndicator.classList.remove('hidden');
});

socket.on('user-stop-typing', () => {
    typingIndicator.classList.add('hidden');
});

socket.on('kicked', () => {
    alert('You have been kicked from the room.'); // Changed from showKickModal/hideKickModal
    location.reload();
});

messageInput.addEventListener('input', () => {
    if (!isTyping) {
        isTyping = true;
        socket.emit('typing', { roomCode: currentRoomCode, userName: currentUserName });
    }
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        stopTyping();
    }, 1500);
});

function stopTyping() {
    isTyping = false;
    socket.emit('stop-typing', currentRoomCode);
}

// Removed confirmKickBtn.addEventListener logic

window.toggleUsersList = function() {
    const usersSidebar = document.getElementById('users-list');
    usersSidebar.classList.toggle('hidden');
};

function showReactionPicker(messageId, buttonElement) {
    const emojis = ['👍', '❤️', '😂', '👎', '💡'];
    const selectedEmoji = prompt(`React with: ${emojis.join(', ')} or type your own emoji:`);

    if (selectedEmoji) {
        reactToMessage(messageId, selectedEmoji);
    }
}

function reactToMessage(messageId, emoji) {
    socket.emit('react-message', { roomCode: currentRoomCode, messageId, emoji, userName: currentUserName });
}

function editMessage(messageId, currentText) {
    const newText = prompt('Edit your message:', currentText);
    if (newText && newText.trim() !== currentText.trim()) {
        socket.emit('edit-message', { roomCode: currentRoomCode, messageId, newText: newText.trim() });
    }
}

function deleteMessage(messageId) {
    if (confirm('Are you sure you want to delete this message?')) {
        socket.emit('delete-message', messageId);
    }
}

window.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const preRoom = params.get('room');
    if (preRoom) {
        document.getElementById('roomInput').value = preRoom;
    }

    // Removed calls to hideLoading, hideError, hideConfirmLeaveModal, hideKickModal
});

messageInput.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        sendMessage();
    }
});

nameInput.addEventListener('keypress', function(e) { if (e.key === 'Enter') joinChat(false); });
roomInput.addEventListener('keypress', function(e) { if (e.key === 'Enter') joinChat(false); });
joinPasswordInput.addEventListener('keypress', function(e) { if (e.key === 'Enter') joinChat(false); });
createPasswordInput.addEventListener('keypress', function(e) { if (e.key === 'Enter') generateRoom(); });

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
