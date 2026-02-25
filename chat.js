// --- 1. ユーザー管理 ---
let myUUID = localStorage.getItem('chat_user_uuid') || crypto.randomUUID();
localStorage.setItem('chat_user_uuid', myUUID);
let myDisplayName = localStorage.getItem('chat_my_name') || "自分";

// --- 2. Supabase設定 ---
const SB_URL = 'https://dkyhhoqzphpwwnnwmdzq.supabase.co/rest/v1';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRreWhob3F6cGhwd3dubndtZHpxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE5MzIyMjEsImV4cCI6MjA4NzUwODIyMX0.ZDWsgWzwZFdBGv31njaNL_QkJAjwHPZj6IFutIOlfPk';
const HEADERS = { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' };

// --- 3. 状態管理 ---
let currentFriendUUID = null;
let friends = []; 
let lastMsgCount = 0;
let notificationSettings = JSON.parse(localStorage.getItem('chat_notify_settings') || '{}');
let imgHistory = JSON.parse(localStorage.getItem('chat_img_history') || '[]');

// --- 4. 通知ロジック ---

window.toggleNotification = async () => {
    const isChecked = document.getElementById('notify-toggle').checked;
    
    if (isChecked) {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            alert("ブラウザの通知設定を許可してください。");
            document.getElementById('notify-toggle').checked = false;
            return;
        }
    }
    
    if (currentFriendUUID) {
        notificationSettings[currentFriendUUID] = isChecked;
        localStorage.setItem('chat_notify_settings', JSON.stringify(notificationSettings));
    }
};

function showNotification(senderName, content) {
    if (Notification.permission === 'granted') {
        // サービスワーカー経由で通知を表示（バックグラウンド対応）
        navigator.serviceWorker.ready.then(registration => {
            registration.showNotification(`新着メッセージ: ${senderName}`, {
                body: content.includes('/storage/v1/object/public/') ? '[画像が届きました]' : content,
                icon: 'https://cdn-icons-png.flaticon.com/512/733/733585.png',
                badge: 'https://cdn-icons-png.flaticon.com/512/733/733585.png',
                tag: 'chat-notification',
                renotify: true
            });
        });
    }
}

// --- 5. 画像・チャットロジック ---

function checkImageQuota() {
    const now = Date.now();
    imgHistory = imgHistory.filter(ts => now - ts < 3600000);
    localStorage.setItem('chat_img_history', JSON.stringify(imgHistory));
    return imgHistory.length < 5;
}

function dataUrlToBlob(dataUrl) {
    const parts = dataUrl.split(';base64,');
    const bin = atob(parts[1]);
    const buffer = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buffer[i] = bin.charCodeAt(i);
    return new Blob([buffer], { type: 'image/jpeg' });
}

async function sendImageMessage(dataUrl) {
    if (!currentFriendUUID) return;
    if (!checkImageQuota()) { alert("画像送信は1時間に5枚までです。"); return; }
    try {
        const blob = dataUrlToBlob(dataUrl);
        const fileName = `${Date.now()}_${crypto.randomUUID()}.jpg`;
        const storageUrl = SB_URL.replace('/rest/v1', '/storage/v1') + `/object/chat-images/${myUUID}/${fileName}`;
        const res = await fetch(storageUrl, {
            method: 'POST',
            headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`, 'Content-Type': 'image/jpeg' },
            body: blob
        });
        if (!res.ok) throw new Error("Upload Failed");
        const publicUrl = SB_URL.replace('/rest/v1', '/storage/v1') + `/object/public/chat-images/${myUUID}/${fileName}`;
        await fetch(`${SB_URL}/chat_messages`, { 
            method: 'POST', 
            headers: HEADERS, 
            body: JSON.stringify({ from_uuid: myUUID, to_uuid: currentFriendUUID, content: publicUrl }) 
        });
        imgHistory.push(Date.now());
        localStorage.setItem('chat_img_history', JSON.stringify(imgHistory));
        loadChatHistory(currentFriendUUID, true);
    } catch (err) { alert("送信失敗"); console.error(err); }
}

async function syncFriends() {
    try {
        const url = `${SB_URL}/friend_relations?or=(user_a.eq.${myUUID},user_b.eq.${myUUID})`;
        const res = await fetch(url, { headers: HEADERS });
        const dbRelations = await res.json();
        const dbUuids = [...new Set(dbRelations.map(rel => (rel.user_a === myUUID) ? rel.user_b : rel.user_a))];
        
        const updatedFriends = [];
        for (const uid of dbUuids) {
            const resN = await fetch(`${SB_URL}/users?uuid=eq.${uid}&select=display_name`, { headers: HEADERS });
            const dataN = await resN.json();
            const name = (dataN && dataN[0]) ? dataN[0].display_name : `User-${uid.substring(0,4)}`;
            updatedFriends.push({ uuid: uid, name: name });
        }
        friends = updatedFriends;
        renderFriendList();
    } catch (e) { console.error("Sync Error:", e); }
}

async function loadChatHistory(friendUuid, silent = true) {
    if (!friendUuid) return;
    try {
        const cond = `or=(and(from_uuid.eq.${myUUID},to_uuid.eq.${friendUuid}),and(from_uuid.eq.${friendUuid},to_uuid.eq.${myUUID}))`;
        const url = `${SB_URL}/chat_messages?select=*&${cond}&order=created_at.asc`;
        const res = await fetch(url, { headers: HEADERS });
        const history = await res.json();

        if (history.length > lastMsgCount) {
            const container = document.getElementById('chat-container');
            
            if (!silent && lastMsgCount > 0) {
                const latestMsg = history[history.length - 1];
                if (latestMsg.from_uuid !== myUUID && notificationSettings[friendUuid]) {
                    const sender = friends.find(f => f.uuid === friendUuid);
                    showNotification(sender ? sender.name : "フレンド", latestMsg.content);
                }
            }

            container.innerHTML = '';
            history.forEach(msg => {
                const div = document.createElement('div');
                div.className = `msg ${msg.from_uuid === myUUID ? 'me' : 'other'}`;
                if (msg.content.includes('/storage/v1/object/public/')) {
                    const img = document.createElement('img');
                    img.src = msg.content;
                    img.onclick = () => window.open(msg.content, '_blank');
                    div.appendChild(img);
                } else {
                    div.innerText = msg.content;
                }
                container.appendChild(div);
            });
            lastMsgCount = history.length;
            container.scrollTop = container.scrollHeight;
        }
    } catch (e) { console.error(e); }
}

// --- 6. UI表示 ---

function renderFriendList() {
    const container = document.getElementById('friend-list-container');
    container.innerHTML = '';
    friends.forEach(f => {
        const div = document.createElement('div');
        div.className = `friend-icon ${currentFriendUUID === f.uuid ? 'active' : ''}`;
        div.innerHTML = `<span>👤</span><span class="friend-name">${f.name}</span>`;
        div.onclick = () => {
            currentFriendUUID = f.uuid;
            lastMsgCount = 0;
            document.getElementById('chat-with-name').innerText = `${f.name} とのチャット`;
            document.getElementById('notify-area').style.display = 'block';
            document.getElementById('notify-toggle').checked = !!notificationSettings[f.uuid];
            renderFriendList();
            loadChatHistory(f.uuid, true);
        };
        container.appendChild(div);
    });
}

function renderDeleteList() {
    const container = document.getElementById('delete-friend-list');
    container.innerHTML = friends.length ? '' : '<div style="font-size:11px; color:#999;">登録なし</div>';
    friends.forEach(f => {
        const div = document.createElement('div');
        div.className = 'delete-item';
        div.innerHTML = `<span>${f.name}</span><button class="del-btn" onclick="removeFriend('${f.uuid}')">解除</button>`;
        container.appendChild(div);
    });
}

// --- 7. アクション ---

window.addFriend = async () => {
    const input = document.getElementById('friend-code-input');
    const code = input.value.trim().toUpperCase();
    if (!code) return;
    await fetch(`${SB_URL}/users`, { method: 'POST', headers: { ...HEADERS, 'Prefer': 'resolution=merge-duplicates' }, body: JSON.stringify({ uuid: myUUID, display_name: myDisplayName }) });
    const res = await fetch(`${SB_URL}/friend_codes?code=eq.${code}&select=uuid`, { headers: HEADERS });
    const data = await res.json();
    if (data.length > 0 && data[0].uuid !== myUUID) {
        await fetch(`${SB_URL}/friend_relations`, { method: 'POST', headers: HEADERS, body: JSON.stringify({ user_a: myUUID, user_b: data[0].uuid }) });
        input.value = '';
        syncFriends(); closeAllModals();
    } else { alert("無効なコードです"); }
};

window.saveMyName = async () => {
    const val = document.getElementById('my-name-input').value.trim();
    if (val) {
        myDisplayName = val;
        localStorage.setItem('chat_my_name', val);
        await fetch(`${SB_URL}/users`, { method: 'POST', headers: { ...HEADERS, 'Prefer': 'resolution=merge-duplicates' }, body: JSON.stringify({ uuid: myUUID, display_name: val }) });
        closeAllModals(); syncFriends();
    }
};

window.removeFriend = async (targetUuid) => {
    if (!confirm("本当に解除しますか？")) return;
    const cond = `or=(and(user_a.eq.${myUUID},user_b.eq.${targetUuid}),and(user_a.eq.${targetUuid},user_b.eq.${myUUID}))`;
    await fetch(`${SB_URL}/friend_relations?${cond}`, { method: 'DELETE', headers: HEADERS });
    syncFriends();
};

window.showFriendModal = async () => {
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    document.getElementById('my-temp-code').innerText = code;
    document.getElementById('friend-modal').style.display = 'block';
    document.getElementById('overlay').style.display = 'block';
    await fetch(`${SB_URL}/friend_codes`, { method: 'POST', headers: HEADERS, body: JSON.stringify({ code: code, uuid: myUUID }) });
};

window.showSettingsModal = () => {
    document.getElementById('my-name-input').value = myDisplayName;
    document.getElementById('my-uuid-display').innerText = myUUID;
    renderDeleteList();
    document.getElementById('settings-modal').style.display = 'block';
    document.getElementById('overlay').style.display = 'block';
};

window.closeAllModals = () => { document.querySelectorAll('.modal, .overlay').forEach(el => el.style.display = 'none'); };
window.copyUUID = () => { navigator.clipboard.writeText(myUUID); alert("UUIDをコピーしました"); };

async function sendMessage() {
    const input = document.getElementById('msg-input');
    const content = input.value.trim();
    if (!content || !currentFriendUUID) return;
    input.value = '';
    await fetch(`${SB_URL}/chat_messages`, { method: 'POST', headers: HEADERS, body: JSON.stringify({ from_uuid: myUUID, to_uuid: currentFriendUUID, content: content }) });
    loadChatHistory(currentFriendUUID, true);
}

// 初期化
window.addEventListener('DOMContentLoaded', async () => {
    await syncFriends();
    setInterval(() => { if (currentFriendUUID) loadChatHistory(currentFriendUUID, false); }, 3000);
    setInterval(syncFriends, 10000);
});