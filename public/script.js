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
    document.getElementById('joinSection').scrollIntoView({ behavior: 'smooth' });
  }
};

function joinChat(create = false) {
  userName = document.getElementById('nameInput').value.trim();
  roomCode = document.getElementById('roomInput').value.trim();
  const password = create
    ? document.getElementById('createPassword').value
    : document.getElementById('joinPassword').value;

  if (userName && roomCode) {
    socket.emit('join-room', { userName, roomCode, password, create });
  }
}

function generateRoom() {
  const randomCode = Math.random().toString(36).substring(2, 8);
  document.getElementById('roomInput').value = randomCode;
  document.getElementById('newRoomCode').textContent = randomCode;
  document.getElementById('generatedRoom').style.display = 'block';
  joinChat(true);
}

function copyLink() {
  const code = document.getElementById('roomInput').value.trim();
  const url = `${window.location.origin}?room=${code}`;
  navigator.clipboard.writeText(url).then(() => alert("Invite link copied!"));
}

socket.on('connect', () => {
  socketId = socket.id;
});

socket.on('room-error', msg => alert(msg));

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
      btn.onclick = () => {
        socket.emit('kick-user', { roomCode, targetId: u.id });
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
  const isMe = sender === userName;

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
  });
  div.addEventListener('touchend', () => clearTimeout(pressTimer));
  div.addEventListener('touchmove', () => clearTimeout(pressTimer));

  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;

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
    container.textContent = reactions.map(r => `${r.emoji} (${r.count})`).join(' ');
  }
});

function editMessage(messageId) {
  const msgDiv = document.querySelector(`[data-id='${messageId}']`);
  if (!msgDiv) return;
  const span = msgDiv.querySelector('.msg-text');
  const newText = prompt('Edit your message:', span.textContent);
  if (newText !== null) {
    socket.emit('edit-message', { roomCode, messageId, newText });
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
document.getElementById('messages').after(typingText);

let typingTimeout;
document.getElementById('messageInput').addEventListener('input', () => {
  socket.emit('typing', { roomCode, userName });
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    socket.emit('stop-typing', roomCode);
  }, 1000);
});

socket.on('user-typing', (name) => {
  typingText.textContent = `${name} is typing...`;
});

socket.on('user-stop-typing', () => {
  typingText.textContent = '';
});

socket.on('kicked', () => {
  alert("You were kicked from the room.");
  location.reload();
});

const actionMenu = document.createElement('div');
actionMenu.id = 'actionMenu';
actionMenu.style.position = 'absolute';
actionMenu.style.display = 'none';
actionMenu.style.zIndex = 1000;
actionMenu.style.background = '#fff';
actionMenu.style.border = '1px solid #ccc';
actionMenu.style.borderRadius = '6px';
actionMenu.style.padding = '5px';
actionMenu.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
document.body.appendChild(actionMenu);

function showActionsMenu(x, y, messageId, isMe) {
  let html = `
    <div onclick="react('${messageId}', '👍')">👍 React</div>
    <div onclick="react('${messageId}', '❤️')">❤️ React</div>
    <div onclick="react('${messageId}', '😂')">😂 React</div>
  `;
  if (isMe) {
    html += `
      <div onclick="editMessage('${messageId}')">✏️ Edit</div>
      <div onclick="deleteMessage('${messageId}')">🗑️ Delete</div>
    `;
  }
  actionMenu.innerHTML = html;
  actionMenu.style.left = `${x}px`;
  actionMenu.style.top = `${y}px`;
  actionMenu.style.display = 'block';
}

document.addEventListener('click', (e) => {
  actionMenu.style.display = 'none';
  document.querySelectorAll('.message.show-actions').forEach(msg => {
    if (!msg.contains(e.target)) msg.classList.remove('show-actions');
  });
});

// Ask permission for notifications
if ('Notification' in window && Notification.permission !== 'granted') {
  Notification.requestPermission();
}
