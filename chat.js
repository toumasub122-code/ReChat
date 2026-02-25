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
let friendUuids = JSON.parse(localStorage.getItem('chat_friend_uuids') || '[]');
let friends = []; 
let lastMsgCount = 0;
let notificationSettings = JSON.parse(localStorage.getItem('chat_notify_settings') || '{}');
let myIsAdmin = false;

// --- 4. 通知機能 ---
function sendBrowserNotification(title, body) {
    if (Notification.permission === "granted") {
        new Notification(title, { body: body });
    }
}

window.toggleNotification = () => {
    if (!currentFriendUUID) return;
    const isEnabled = document.getElementById('notify-toggle').checked;
    notificationSettings[currentFriendUUID] = isEnabled;
    localStorage.setItem('chat_notify_settings', JSON.stringify(notificationSettings));
    if (isEnabled && Notification.permission === "default") {
        Notification.requestPermission();
    }
};

// --- 5. 同期・削除ロジック (統合済み) ---
async function syncFriends() {
    try {
        const url = `${SB_URL}/friend_relations?or=(user_a.eq.${myUUID},user_b.eq.${myUUID})`;
        const res = await fetch(url, { headers: HEADERS });
        const dbRelations = await res.json();
        
        const dbUuids = dbRelations.map(rel => (rel.user_a === myUUID) ? rel.user_b : rel.user_a);
        
        // DBの状態を正として同期（LocalStorageの古い情報を上書き）
        friendUuids = dbUuids;
        localStorage.setItem('chat_friend_uuids', JSON.stringify(friendUuids));

        const updatedFriends = [];
        for (const uid of friendUuids) {
            const resN = await fetch(`${SB_URL}/users?uuid=eq.${uid}&select=display_name`, { headers: HEADERS });
            const dataN = await resN.json();
            const name = dataN[0]?.display_name || `User-${uid.substring(0,4)}`;
            updatedFriends.push({ uuid: uid, name: name });
        }
        friends = updatedFriends;

        // 相手が削除した場合、即座にチャット画面を閉じる
        if (currentFriendUUID && !friendUuids.includes(currentFriendUUID)) {
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
    if (!confirm("フレンドを解除しますか？")) return;
    try {
        const condition = `or(and(user_a.eq.${myUUID},user_b.eq.${targetUuid}),and(user_a.eq.${targetUuid},user_b.eq.${myUUID}))`;
        const url = `${SB_URL}/friend_relations?${condition}`;
        const res = await fetch(url, { method: 'DELETE', headers: HEADERS });
        if (res.ok) await syncFriends(); 
    } catch (e) { console.error("削除エラー:", e); }
};

// --- 6. メッセージ機能 ---
async function loadChatHistory(friendUuid, silent = true) {
    if (!friendUuid) return;
    try {
        const filter = `and(from_uuid.eq.${myUUID},to_uuid.eq.${friendUuid}),and(from_uuid.eq.${friendUuid},to_uuid.eq.${myUUID})`;
        const url = `${SB_URL}/chat_messages?select=*&or=(${filter})&order=created_at.asc`;
        const res = await fetch(url, { headers: HEADERS });
        const history = await res.json();
        
        if (history.length > lastMsgCount) {
            if (!silent && history.length > 0) {
                const lastMsg = history[history.length - 1];
                if (lastMsg.from_uuid === friendUuid && notificationSettings[friendUuid] === true) {
                    const partner = friends.find(f => f.uuid === friendUuid);
                    sendBrowserNotification(partner ? partner.name : "新着メッセージ", lastMsg.content);
                }
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
    } catch (e) {}
}

// --- 7. UI表示 ---
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
    container.innerHTML = '';
    if (friends.length === 0) {
        container.innerHTML = '<div style="font-size:11px; color:#999; margin-top:5px;">登録なし</div>';
        return;
    }
    friends.forEach(f => {
        const div = document.createElement('div');
        div.className = 'delete-item';
        div.innerHTML = `<span>${f.name}</span><button class="del-btn" onclick="removeFriend('${f.uuid}')">解除</button>`;
        container.appendChild(div);
    });
}

// --- 8. 各種アクション ---
window.addFriend = async () => {
    const code = document.getElementById('friend-code-input').value.trim().toUpperCase();
    const res = await fetch(`${SB_URL}/friend_codes?code=eq.${code}&select=uuid`, { headers: HEADERS });
    const data = await res.json();
    if (data.length > 0 && data[0].uuid !== myUUID) {
        await fetch(`${SB_URL}/friend_relations`, { 
            method: 'POST', 
            headers: HEADERS, 
            body: JSON.stringify({ user_a: myUUID, user_b: data[0].uuid }) 
        });
        await syncFriends(); 
        closeAllModals();
    }
};

window.saveMyName = async () => {
    const val = document.getElementById('my-name-input').value.trim();
    if (val) {
        myDisplayName = val; localStorage.setItem('chat_my_name', val);
        await fetch(`${SB_URL}/users`, { method: 'POST', headers: { ...HEADERS, 'Prefer': 'resolution=merge-duplicates' }, body: JSON.stringify({ uuid: myUUID, display_name: val }) });
        closeAllModals();
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
window.copyUUID = () => { navigator.clipboard.writeText(myUUID); };

async function checkMyStatus() {
    try {
        const res = await fetch(`${SB_URL}/users?uuid=eq.${myUUID}&select=is_admin`, { headers: HEADERS });
        const data = await res.json();
        if (data && data[0]) { myIsAdmin = data[0].is_admin; }
    } catch (e) {}
}

// --- 9. 初期化 ---
window.addEventListener('DOMContentLoaded', async () => {
    await checkMyStatus();
    await syncFriends();

    document.getElementById('send-btn').onclick = async () => {
        const input = document.getElementById('msg-input');
        if (!input.value.trim() || !currentFriendUUID) return;
        const content = input.value.trim();
        input.value = '';
        await fetch(`${SB_URL}/chat_messages`, { 
            method: 'POST', 
            headers: HEADERS, 
            body: JSON.stringify({ from_uuid: myUUID, to_uuid: currentFriendUUID, content: content }) 
        });
        loadChatHistory(currentFriendUUID, true);
    };

    setInterval(() => { if (currentFriendUUID) loadChatHistory(currentFriendUUID, false); }, 3000);
    setInterval(syncFriends, 5000); // 5秒ごとにDBと同期。削除の反映場所
    setInterval(checkMyStatus, 30000);
});