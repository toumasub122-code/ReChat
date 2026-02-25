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

// --- 4. 通知機能 ---
function sendBrowserNotification(title, body) {
    if (Notification.permission === "granted") {
        try {
            new Notification(title, { body: body, icon: 'https://cdn-icons-png.flaticon.com/512/733/733585.png' });
        } catch (e) { console.error(e); }
    }
}

window.toggleNotification = async () => {
    if (!currentFriendUUID) return;
    const isEnabled = document.getElementById('notify-toggle').checked;
    if (isEnabled && Notification.permission !== "granted") {
        await Notification.requestPermission();
    }
    notificationSettings[currentFriendUUID] = isEnabled;
    localStorage.setItem('chat_notify_settings', JSON.stringify(notificationSettings));
};

// --- 5. 同期・削除ロジック ---
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

        if (currentFriendUUID && !dbUuids.includes(currentFriendUUID)) {
            currentFriendUUID = null;
            document.getElementById('chat-container').innerHTML = '';
            document.getElementById('chat-with-name').innerText = '相手を選択してください';
            document.getElementById('notify-area').style.display = 'none';
        }
        renderFriendList();
        if (document.getElementById('settings-modal').style.display === 'block') renderDeleteList();
    } catch (e) { console.error("Sync Error:", e); }
}

window.removeFriend = async (targetUuid) => {
    if (!confirm("本当に解除しますか？")) return;
    const cond = `or=(and(user_a.eq.${myUUID},user_b.eq.${targetUuid}),and(user_a.eq.${targetUuid},user_b.eq.${myUUID}))`;
    await fetch(`${SB_URL}/friend_relations?${cond}`, { method: 'DELETE', headers: HEADERS });
    syncFriends();
};

// --- 6. メッセージ機能 ---
async function loadChatHistory(friendUuid, silent = true) {
    if (!friendUuid) return;
    try {
        const cond = `or=(and(from_uuid.eq.${myUUID},to_uuid.eq.${friendUuid}),and(from_uuid.eq.${friendUuid},to_uuid.eq.${myUUID}))`;
        const url = `${SB_URL}/chat_messages?select=*&${cond}&order=created_at.asc`;
        const res = await fetch(url, { headers: HEADERS });
        const history = await res.json();

        if (history.length > lastMsgCount) {
            const newMsgs = history.slice(lastMsgCount);
            if (!silent && notificationSettings[friendUuid]) {
                newMsgs.forEach(msg => {
                    if (msg.from_uuid === friendUuid) {
                        const partner = friends.find(f => f.uuid === friendUuid);
                        sendBrowserNotification(partner ? partner.name : "新着", msg.content);
                    }
                });
            }
            const container = document.getElementById('chat-container');
            container.innerHTML = '';
            history.forEach(msg => {
                const div = document.createElement('div');
                div.className = `msg ${msg.from_uuid === myUUID ? 'me' : 'other'}`;
                div.innerText = msg.content;
                container.appendChild(div);
            });
            lastMsgCount = history.length;
            container.scrollTop = container.scrollHeight;
        }
    } catch (e) { console.error(e); }
}

// --- 7. UI表示 ---
function renderFriendList() {
    const container = document.getElementById('friend-list-container');
    container.innerHTML = '';
    friends.forEach(f => {
        const div = document.createElement('div');
        // 選択中のUUIDと一致すれば active クラスを付与
        div.className = `friend-icon ${currentFriendUUID === f.uuid ? 'active' : ''}`;
        div.innerHTML = `<span>👤</span><span class="friend-name">${f.name}</span>`;
        div.onclick = () => {
            currentFriendUUID = f.uuid;
            lastMsgCount = 0;
            document.getElementById('chat-with-name').innerText = `${f.name} とのチャット`;
            document.getElementById('notify-area').style.display = 'block';
            document.getElementById('notify-toggle').checked = !!notificationSettings[f.uuid];
            renderFriendList(); // 再描画して枠線を更新
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

// --- 8. 各種アクション ---
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

window.addEventListener('DOMContentLoaded', async () => {
    await syncFriends();
    document.getElementById('send-btn').onclick = async () => {
        const input = document.getElementById('msg-input');
        const content = input.value.trim();
        if (!content || !currentFriendUUID) return;
        input.value = '';
        await fetch(`${SB_URL}/chat_messages`, { method: 'POST', headers: HEADERS, body: JSON.stringify({ from_uuid: myUUID, to_uuid: currentFriendUUID, content: content }) });
        loadChatHistory(currentFriendUUID, true);
    };
    setInterval(() => { if (currentFriendUUID) loadChatHistory(currentFriendUUID, false); }, 3000);
    setInterval(syncFriends, 10000);
});