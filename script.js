const socket = io();
let userName = '';
let roomCode = '';
let socketId = '';
let messageIdCounter = 0;


function joinChat() {
    window.addEventListener('DOMContentLoaded', () => {
        const params = new URLSearchParams(window.location.search);
        const preRoom = params.get('room');
        if (preRoom) {
          document.getElementById('roomInput').value = preRoom;
        }
      });
      
  userName = document.getElementById('nameInput').value.trim();
  roomCode = document.getElementById('roomInput').value.trim();

  if (userName && roomCode) {
    socket.emit('join-room', { userName, roomCode });
    document.getElementById('login').style.display = 'none';
    document.getElementById('chat').style.display = 'block';
    document.getElementById('roomName').textContent = roomCode;
  }
}

function sendMessage() {
  const input = document.getElementById('messageInput');
  const msg = input.value.trim();
  if (msg) {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const messageId = `${socketId}_${messageIdCounter++}`;
    socket.emit('chat-message', { roomCode, userName, text: msg, time, messageId });
    input.value = '';
  }
}

function react(messageId, emoji) {
  socket.emit('react-message', { roomCode, messageId, emoji, userName });
}

socket.on('update-reactions', ({ messageId, reactions }) => {
  const container = document.getElementById(`react-${messageId}`);
  container.textContent = reactions.map(r => `${r.emoji} (${r.count})`).join(' ');
});

function editMessage(messageId) {
  const msgDiv = document.querySelector(`[data-id='${messageId}']`);
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


socket.on('connect', () => {
  socketId = socket.id;
});


socket.on('chat-message', ({ userName: sender, text, time, messageId }) => {
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

  // 👇 Add right-click (contextmenu) listener
  div.addEventListener('contextmenu', e => {
    e.preventDefault();
    div.classList.toggle('show-actions');
  });

  // 👇 Add long-press listener (for mobile)
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
});


socket.on('room-users', users => {
  const userList = document.getElementById('users');
  userList.innerHTML = '';
  users.forEach(u => {
    const li = document.createElement('li');
    li.textContent = u;
    userList.appendChild(li);
  });
});
function generateRoom() {
    const randomCode = Math.random().toString(36).substring(2, 8);
    document.getElementById('roomInput').value = randomCode;
    document.getElementById('newRoomCode').textContent = randomCode;
    document.getElementById('generatedRoom').style.display = 'block';
  }
  
  function copyLink() {
    const code = document.getElementById('roomInput').value.trim();
    const url = `${window.location.origin}?room=${code}`;
    navigator.clipboard.writeText(url).then(() => {
      alert("Invite link copied!");
    });
  }
  
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

document.addEventListener('click', () => {
  actionMenu.style.display = 'none';
});

document.addEventListener('click', (e) => {
  document.querySelectorAll('.message.show-actions').forEach(msg => {
    if (!msg.contains(e.target)) {
      msg.classList.remove('show-actions');
    }
  });
});
