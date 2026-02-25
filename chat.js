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
let friends = JSON.parse(localStorage.getItem('chat_friends') || '[]');
let lastMsgCount = 0;
// 通知設定 (キー: friendUUID, 値: boolean)
let notificationSettings = JSON.parse(localStorage.getItem('chat_notif_settings') || '{}');

// --- 4. 名前・フレンド管理 ---
async function pushNameToDB(name) {
    try {
        await fetch(`${SB_URL}/users`, {
            method: 'POST',
            headers: { ...HEADERS, 'Prefer': 'resolution=merge-duplicates' },
            body: JSON.stringify({ uuid: myUUID, display_name: name }),
        });
    } catch (e) {}
}

async function getFriendName(uuid) {
    try {
        const res = await fetch(`${SB_URL}/users?uuid=eq.${uuid}&select=display_name`, { headers: HEADERS });
        const data = await res.json();
        return (data.length > 0 && data[0].display_name) ? data[0].display_name : `User-${uuid.substring(0,4)}`;
    } catch (e) { return `User-${uuid.substring(0,4)}`; }
}

async function loadChatHistory(friendUuid) {
    if (!friendUuid) return;
    try {
        const filter = `and(from_uuid.eq.${myUUID},to_uuid.eq.${friendUuid}),and(from_uuid.eq.${friendUuid},to_uuid.eq.${myUUID})`;
        const url = `${SB_URL}/chat_messages?select=*&or=(${filter})&order=created_at.asc`;
        const res = await fetch(url, { headers: HEADERS });
        const history = await res.json();
        
        if (history.length !== lastMsgCount) {
            const container = document.getElementById('chat-container');
            const isFirstLoad = lastMsgCount === 0;
            
            // 通知判定
            if (!isFirstLoad && history.length > lastMsgCount) {
                const lastMsg = history[history.length - 1];
                if (lastMsg.from_uuid !== myUUID && notificationSettings[friendUuid]) {
                    new Notification("新着メッセージ", { body: lastMsg.content });
                }
            }

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
    } catch (e) {}
}

async function syncFriends() {
    try {
        const url = `${SB_URL}/friend_relations?or=(user_a.eq.${myUUID},user_b.eq.${myUUID})`;
        const res = await fetch(url, { headers: HEADERS });
        const data = await res.json();
        const dbUuids = data.map(rel => (rel.user_a === myUUID) ? rel.user_b : rel.user_a);
        
        let changed = false;
        // DBにあるフレンドの名前を最新に更新（相手が名前を変えた場合に備える）
        const updatedFriends = [];
        for (const uid of dbUuids) {
            const latestName = await getFriendName(uid);
            const existing = friends.find(f => f.uuid === uid);
            if (!existing || existing.name !== latestName) {
                changed = true;
            }
            updatedFriends.push({ uuid: uid, name: latestName });
        }

        // 削除されたフレンドのチェック
        if (friends.length !== updatedFriends.length) changed = true;

        if (changed) {
            friends = updatedFriends;
            localStorage.setItem('chat_friends', JSON.stringify(friends));
            renderFriendList();
            if (currentFriendUUID) {
                const f = friends.find(f => f.uuid === currentFriendUUID);
                if (f) document.getElementById('chat-with-name').innerText = `${f.name} とのチャット`;
            }
        }
    } catch (e) {}
}

// --- 5. UI描画 ---
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
            document.getElementById('chat-container').innerHTML = '';
            updateNotifBtnUI();
            renderFriendList();
            loadChatHistory(f.uuid);
        };
        container.appendChild(div);
    });
}

function updateNotifBtnUI() {
    const btn = document.getElementById('notif-toggle-btn');
    if (!currentFriendUUID) {
        btn.style.display = 'none';
        return;
    }
    btn.style.display = 'flex';
    const isOn = notificationSettings[currentFriendUUID] || false;
    btn.className = isOn ? 'active' : '';
    document.getElementById('notif-icon').innerText = isOn ? '🔔' : '🔕';
    document.getElementById('notif-status').innerText = isOn ? 'ON' : 'OFF';
}

window.toggleNotification = () => {
    if (!currentFriendUUID) return;
    
    // ブラウザの通知許可リクエスト
    if (Notification.permission === "default") {
        Notification.requestPermission();
    }

    const currentStatus = notificationSettings[currentFriendUUID] || false;
    notificationSettings[currentFriendUUID] = !currentStatus;
    localStorage.setItem('chat_notif_settings', JSON.stringify(notificationSettings));
    updateNotifBtnUI();
};

function renderDeleteFriendList() {
    const container = document.getElementById('delete-friend-list');
    if(!container) return;
    container.innerHTML = friends.length ? '' : '<p>フレンドはいません</p>';
    friends.forEach(f => {
        const item = document.createElement('div');
        item.style = "display:flex; justify-content:space-between; align-items:center; padding:10px; border-bottom:1px solid #eee;";
        item.innerHTML = `<span>${f.name}</span><button onclick="deleteFriend('${f.uuid}')" style="background:#e74c3c;color:white;border:none;border-radius:4px;padding:4px 10px;cursor:pointer;">削除</button>`;
        container.appendChild(item);
    });
}

// --- 6. アクション ---
window.deleteFriend = async (uuid) => {
    if (!confirm("削除しますか？")) return;
    const query = `or=(and(user_a.eq.${myUUID},user_b.eq.${uuid}),and(user_a.eq.${uuid},user_b.eq.${myUUID}))`;
    await fetch(`${SB_URL}/friend_relations?${query}`, { method: 'DELETE', headers: HEADERS });
    friends = friends.filter(f => f.uuid !== uuid);
    localStorage.setItem('chat_friends', JSON.stringify(friends));
    if (currentFriendUUID === uuid) { currentFriendUUID = null; document.getElementById('notif-toggle-btn').style.display = 'none'; }
    renderFriendList(); renderDeleteFriendList();
};

window.saveMyName = async () => {
    const val = document.getElementById('my-name-input').value.trim();
    if (val) { 
        myDisplayName = val; 
        localStorage.setItem('chat_my_name', val); 
        await pushNameToDB(val); 
        closeAllModals(); 
        syncFriends(); 
    }
};

window.addFriend = async () => {
    const code = document.getElementById('friend-code-input').value.trim().toUpperCase();
    const res = await fetch(`${SB_URL}/friend_codes?code=eq.${code}&select=uuid`, { headers: HEADERS });
    const data = await res.json();
    if (data.length > 0 && data[0].uuid !== myUUID) {
        await fetch(`${SB_URL}/friend_relations`, { method: 'POST', headers: HEADERS, body: JSON.stringify({ user_a: myUUID, user_b: data[0].uuid }) });
        syncFriends(); closeAllModals();
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
    renderDeleteFriendList();
    document.getElementById('settings-modal').style.display = 'block';
    document.getElementById('overlay').style.display = 'block';
};

window.closeAllModals = () => { document.querySelectorAll('.modal, .overlay').forEach(el => el.style.display = 'none'); };

// --- 7. 初期化 ---
window.addEventListener('DOMContentLoaded', () => {
    pushNameToDB(myDisplayName);
    
    document.getElementById('send-btn').onclick = async () => {
        const input = document.getElementById('msg-input');
        if (!input.value.trim() || !currentFriendUUID) return;
        await fetch(`${SB_URL}/chat_messages`, { method: 'POST', headers: HEADERS, body: JSON.stringify({ from_uuid: myUUID, to_uuid: currentFriendUUID, content: input.value.trim() }) });
        input.value = '';
        loadChatHistory(currentFriendUUID);
    };

    renderFriendList();
    syncFriends();

    // 定期更新
    setInterval(() => { if (currentFriendUUID) loadChatHistory(currentFriendUUID); }, 3000);
    setInterval(syncFriends, 8000); // 名前変更を反映するために定期同期
});