/**
 * BlueMesh Messenger Core Logic
 * Версия: 1.0.0
 * Автор: AI Assistant
 */

// --- КОНФИГУРАЦИЯ И ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ---
const CONFIG = {
    SERVICE_UUID: '0000fff0-0000-1000-8000-00805f9b34fb', // UUID для передачи данных
    CHARACTERISTIC_UUID: '0000fff1-0000-1000-8000-00805f9b34fb'
};

let state = {
    user: null,
    currentChat: null,
    bluetoothDevice: null,
    bluetoothServer: null,
    bluetoothCharacteristic: null,
    chats: [],
    contacts: []
};

// --- СИСТЕМНЫЕ ФУНКЦИИ (PWA & AUTH) ---

// Регистрация Service Worker для работы оффлайн
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then(() => {
        console.log('Service Worker Registered');
    });
}

// Имитация входа по номеру
function sendCode() {
    const phone = document.getElementById('phone-input').value;
    if(phone.length < 5) return alert('Введите номер');
    
    // В реальности здесь запрос к API
    document.getElementById('code-area').style.display = 'block';
    alert(`Код отправлен на ${phone}: 1234`);
}

function verifyCode() {
    const code = document.getElementById('code-input').value;
    if(code === '1234') {
        // Успешный вход
        state.user = {
            name: "Alex",
            phone: document.getElementById('phone-input').value,
            avatar: "https://via.placeholder.com/150"
        };
        loadProfile();
        switchScreen('main-screen');
        requestContacts();
    } else {
        alert('Неверный код');
    }
}

function switchScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}

function loadProfile() {
    document.getElementById('my-name').innerText = state.user.name;
    document.getElementById('my-avatar').src = state.user.avatar;
}

// Доступ к контактам
async function requestContacts() {
    if ('contacts' in navigator && 'select' in navigator.contacts) {
        try {
            const props = ['name', 'tel'];
            const contacts = await navigator.contacts.select(props, { multiple: true });
            state.contacts = contacts;
            console.log('Контакты загружены:', contacts);
            // Здесь логика добавления контактов в базу
        } catch (err) {
            console.log('Доступ к контактам запрещен или не поддерживается');
        }
    }
}

// --- BLUETOOTH ЛОГИКА (Web Bluetooth API) ---

async function scanDevices() {
    if (!navigator.bluetooth) {
        return alert('Ваш браузер не поддерживает Web Bluetooth. Используйте Chrome на Android.');
    }

    document.getElementById('scan-modal').style.display = 'flex';
    const list = document.getElementById('device-list');
    list.innerHTML = '<div style="padding:10px;">Сканирование...</div>';

    try {
        // Запрос на подключение к устройству
        // Примечание: В реальном P2P мессенджере тут сложнее, так как нужно фильтровать по имени сервиса
        const device = await navigator.bluetooth.requestDevice({
            filters: [{ services: [CONFIG.SERVICE_UUID] }],
            optionalServices: [CONFIG.SERVICE_UUID]
        });

        state.bluetoothDevice = device;
        connectToDevice(device);
        document.getElementById('scan-modal').style.display = 'none';

    } catch (error) {
        console.error(error);
        list.innerHTML = '<div style="padding:10px; color:red;">Ошибка или отмена</div>';
    }
}

async function connectToDevice(device) {
    try {
        const server = await device.gatt.connect();
        const service = await server.getPrimaryService(CONFIG.SERVICE_UUID);
        const characteristic = await service.getCharacteristic(CONFIG.CHARACTERISTIC_UUID);
        
        state.bluetoothCharacteristic = characteristic;
        
        // Подписка на входящие сообщения
        await characteristic.startNotifications();
        characteristic.addEventListener('characteristicvaluechanged', handleIncomingMessage);
        
        alert('Устройство подключено!');
        // Создаем чат с этим устройством
        createChat(device.name || "Unknown Device", device.id);

    } catch (error) {
        console.error('Connection failed:', error);
    }
}

// --- ОБРАБОТКА СООБЩЕНИЙ ---

function handleIncomingMessage(event) {
    const value = event.target.value;
    const decoder = new TextDecoder('utf-8');
    const messageData = JSON.parse(decoder.decode(value));
    
    // messageData = { type: 'text'|'voice'|'image', content: '...', timestamp: ... }
    addMessageToUI(messageData, 'in');
}

async function sendMessage() {
    const input = document.getElementById('message-input');
    const text = input.value;
    if (!text && !state.currentChat) return;

    const msgObj = {
        type: 'text',
        content: text,
        timestamp: Date.now(),
        sender: 'me'
    };

    await sendBluetoothData(msgObj);
    addMessageToUI(msgObj, 'out');
    input.value = '';
}

async function sendBluetoothData(dataObj) {
    if (!state.bluetoothCharacteristic) {
        console.warn('Нет активного Bluetooth соединения');
        // В режиме "без интернета" это критично, но для демо можно логировать
        return; 
    }
    const encoder = new TextEncoder();
    const data = encoder.encode(JSON.stringify(dataObj));
    await state.bluetoothCharacteristic.writeValue(data);
}

function addMessageToUI(msg, type) {
    const area = document.getElementById('messages-area');
    const div = document.createElement('div');
    div.className = `message msg-${type}`;
    
    let contentHtml = '';
    if(msg.type === 'text') contentHtml = msg.content;
    if(msg.type === 'image') contentHtml = `<img src="${msg.content}" style="max-width:100%; border-radius:10px;">`;
    if(msg.type === 'voice') contentHtml = `<audio controls src="${msg.content}"></audio>`;

    div.innerHTML = `
        ${contentHtml}
        <div class="msg-meta">${new Date(msg.timestamp).toLocaleTimeString()}</div>
    `;
    area.appendChild(div);
    area.scrollTop = area.scrollHeight;
}

// --- ГОЛОСОВЫЕ СООБЩЕНИЯ И ФОТО ---

let mediaRecorder;
let audioChunks = [];

function startRecord() {
    navigator.mediaDevices.getUserMedia({ audio: true })
        .then(stream => {
            mediaRecorder = new MediaRecorder(stream);
            mediaRecorder.start();
            document.getElementById('rec-indicator').style.display = 'block';
            
            mediaRecorder.ondataavailable = event => {
                audioChunks.push(event.data);
            };

            mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                audioChunks = [];
                
                // Конвертация в Base64 для отправки (упрощенно)
                const reader = new FileReader();
                reader.readAsDataURL(audioBlob);
                reader.onloadend = () => {
                    const base64Audio = reader.result;
                    const msgObj = { type: 'voice', content: base64Audio, timestamp: Date.now() };
                    sendBluetoothData(msgObj);
                    addMessageToUI(msgObj, 'out');
                };
            };
        })
        .catch(err => alert('Нужен доступ к микрофону'));
}

function stopRecord() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        document.getElementById('rec-indicator').style.display = 'none';
    }
}

function attachPhoto() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = e => {
        const file = e.target.files[0];
        const reader = new FileReader();
        reader.onload = function(evt) {
            const msgObj = { type: 'image', content: evt.target.result, timestamp: Date.now() };
            sendBluetoothData(msgObj);
            addMessageToUI(msgObj, 'out');
        };
        reader.readAsDataURL(file);
    };
    input.click();
}

// --- НАВИГАЦИЯ ПО ЧАТАМ ---

function createChat(name, id) {
    // Проверка, есть ли уже чат
    const existing = state.chats.find(c => c.id === id);
    if(existing) return;

    const chat = { id, name, lastMsg: 'Подключено', messages: [] };
    state.chats.push(chat);
    renderChatList();
}

function renderChatList() {
    const list = document.getElementById('chat-list');
    // Очищаем кроме системного
    list.innerHTML = `
            <div class="chat-item" onclick="openChat('system')">
                <div class="avatar-small" style="background: #333; display: flex; align-items: center; justify-content: center;"><i class="fas fa-broadcast-tower"></i></div>
                <div class="chat-info">
                    <div class="chat-name">Система</div>
                    <div class="chat-preview">Добро пожаловать в BlueMesh!</div>
                </div>
            </div>
    `;
    
    state.chats.forEach(chat => {
        const item = document.createElement('div');
        item.className = 'chat-item';
        item.onclick = () => openChat(chat.id);
        item.innerHTML = `
            <div class="avatar-small" style="background: #555;"></div>
            <div class="chat-info">
                <div class="chat-name">${chat.name}</div>
                <div class="chat-preview">${chat.lastMsg}</div>
            </div>
        `;
        list.appendChild(item);
    });
}

function openChat(chatId) {
    if(chatId === 'system') return;
    state.currentChat = state.chats.find(c => c.id === chatId);
    document.getElementById('chat-title').innerText = state.currentChat.name;
    document.getElementById('messages-area').innerHTML = ''; // Очистка для демо
    
    // Загрузка истории (если бы она была в базе)
    switchScreen('chat-screen');
}

function closeChat() {
    switchScreen('main-screen');
    state.currentChat = null;
}

function handleInput(e) {
    if(e.key === 'Enter') sendMessage();
}

function closeModal() {
    document.getElementById('scan-modal').style.display = 'none';
}
