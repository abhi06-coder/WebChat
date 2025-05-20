const socket = io();

// THIS IS THE NEW DEBUGGER: A catch-all listener for ALL Socket.IO events
socket.onAny((eventName, ...args) => {
    console.log(`CLIENT DEBUG: Received event: "${eventName}" with data:`, args);
    // If 'room-joined' is received, we can try to force the UI update
    if (eventName === 'room-joined') {
        const { roomCode, userName } = args[0]; // Assuming args is an array and data is the first element
        console.log('CLIENT DEBUG: Attempting UI transition from onAny for room-joined!');
        console.log('CLIENT DEBUG: loginSection (from onAny):', loginSection);
        console.log('CLIENT DEBUG: chatSection (from onAny):', chatSection);
        if (loginSection && chatSection) {
            loginSection.classList.add('hidden');
            chatSection.classList.remove('hidden');
            messageInput.focus();
            console.log('CLIENT DEBUG: Forced UI transition via onAny completed.');
        } else {
            console.error('CLIENT DEBUG: Could not transition UI from onAny: loginSection or chatSection is null!');
        }
    }
});

// Keep your existing specific socket.on('room-joined') as is, with its logs:
socket.on('room-joined', ({ roomCode, userName }) => {
    console.log('DEBUG: room-joined event received! Attempting UI transition.');
    console.log('DEBUG: Current roomCode:', roomCode, 'userName:', userName);

    currentRoomCode = roomCode;
    currentUserName = userName;

    try {
        console.log('DEBUG: Attempting to set roomNameSpan.textContent.');
        console.log('DEBUG: roomNameSpan element before textContent:', roomNameSpan);
        if (roomNameSpan) {
            roomNameSpan.textContent = roomCode;
            console.log('DEBUG: roomNameSpan.textContent set successfully.');
        } else {
            console.error('ERROR: roomNameSpan is null/undefined when trying to set textContent!');
        }

        console.log('DEBUG: Attempting classList operations.');
        console.log('DEBUG: loginSection element before classList:', loginSection);
        console.log('DEBUG: chatSection element before classList:', chatSection);

        if (loginSection) {
            loginSection.classList.add('hidden');
            console.log('DEBUG: loginSection.classList.add("hidden") executed.');
        } else {
            console.error('ERROR: loginSection is null/undefined when trying to add class!');
        }

        if (chatSection) {
            chatSection.classList.remove('hidden');
            console.log('DEBUG: chatSection.classList.remove("hidden") executed.');
        } else {
            console.error('ERROR: chatSection is null/undefined when trying to remove class!');
        }

        messageInput.focus();
        console.log('DEBUG: messageInput.focus() called.');

        console.log('DEBUG: UI transition logic block completed.');

    } catch (e) {
        console.error('CRITICAL ERROR in room-joined UI transition:', e);
        alert(`An internal error occurred: ${e.message}. Check console for details.`);
    }

    if (loginSection) console.log('DEBUG: FINAL loginSection has hidden?', loginSection.classList.contains('hidden'));
    if (chatSection) console.log('DEBUG: FINAL chatSection has hidden?', chatSection.classList.contains('hidden'));
});

// Make sure your socket.on('connect') also has a console.log, e.g.:
socket.on('connect', () => {
    console.log('CLIENT DEBUG: Socket.IO connection established!');
});
