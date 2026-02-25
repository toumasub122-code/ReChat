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
let notificationSettings = JSON.parse(localStorage.getItem('chat_notify_settings') || '{}');
let myIsAdmin = false; // 認証権限フラグ

// --- 4. 通知機能 ---
function requestNotificationPermission() {
    if (Notification.permission === "default") { Notification.requestPermission(); }
}

function sendBrowserNotification(title, body) {
    if (Notification.permission === "granted") { new Notification(title, { body: body }); }
}

window.toggleNotification = () => {
    if (!currentFriendUUID) return;
    const isEnabled = document.getElementById('notify-toggle').checked;
    notificationSettings[currentFriendUUID] = isEnabled;
    localStorage.setItem('chat_notify_settings', JSON.stringify(notificationSettings));
    if (isEnabled && Notification.permission !== "granted") { Notification.requestPermission(); }
};

// --- 5. メッセージ・フレンド機能 ---
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

async function checkMyStatus() {
    try {
        const res = await fetch(`${SB_URL}/users?uuid=eq.${myUUID}&select=is_admin`, { headers: HEADERS });
        const data = await res.json();
        if (data && data[0]) { myIsAdmin = data[0].is_admin; }
    } catch (e) {}
}

async function syncFriends() {
    try {
        const url = `${SB_URL}/friend_relations?or=(user_a.eq.${myUUID},user_b.eq.${myUUID})`;
        const res = await fetch(url, { headers: HEADERS });
        const data = await res.json();
        const dbUuids = data.map(rel => (rel.user_a === myUUID) ? rel.user_b : rel.user_a);
        
        let updated = false;
        for (const uid of dbUuids) {
            if (!friends.find(f => f.uuid === uid)) {
                const resN = await fetch(`${SB_URL}/users?uuid=eq.${uid}&select=display_name`, { headers: HEADERS });
                const dataN = await resN.json();
                const name = dataN[0]?.display_name || `User-${uid.substring(0,4)}`;
                friends.push({ uuid: uid, name: name });
                updated = true;
            }
        }
        if (updated) {
            localStorage.setItem('chat_friends', JSON.stringify(friends));
            renderFriendList();
        }
    } catch (e) {}
}

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

// --- 6. ユーザー管理アクション ---
window.copyUUID = () => {
    navigator.clipboard.writeText(myUUID);
    alert("UUIDをコピーしました");
};

window.saveMyName = async () => {
    const val = document.getElementById('my-name-input').value.trim();
    if (val) {
        myDisplayName = val; localStorage.setItem('chat_my_name', val);
        await fetch(`${SB_URL}/users`, { method: 'POST', headers: { ...HEADERS, 'Prefer': 'resolution=merge-duplicates' }, body: JSON.stringify({ uuid: myUUID, display_name: val }) });
        closeAllModals();
    }
};

window.addFriend = async () => {
    const code = document.getElementById('friend-code-input').value.trim().toUpperCase();
    const res = await fetch(`${SB_URL}/friend_codes?code=eq.${code}&select=uuid`, { headers: HEADERS });
    const data = await res.json();
    
    if (data.length > 0 && data[0].uuid !== myUUID) {
        const targetUuid = data[0].uuid;

        // 認証制ロジック: 自分が管理者なら、追加した相手も管理者（認証済み）にする
        if (myIsAdmin) {
            await fetch(`${SB_URL}/users?uuid=eq.${targetUuid}`, {
                method: 'PATCH',
                headers: HEADERS,
                body: JSON.stringify({ is_admin: true })
            });
        }

        await fetch(`${SB_URL}/friend_relations`, { method: 'POST', headers: HEADERS, body: JSON.stringify({ user_a: myUUID, user_b: targetUuid }) });
        syncFriends(); closeAllModals();
    } else {
        alert("無効なコード、または自分自身です。");
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
    document.getElementById('my-uuid-display').innerText = myUUID; // UUIDを表示
    document.getElementById('settings-modal').style.display = 'block';
    document.getElementById('overlay').style.display = 'block';
};

window.closeAllModals = () => { document.querySelectorAll('.modal, .overlay').forEach(el => el.style.display = 'none'); };

// --- 7. 初期化とループ ---
window.addEventListener('DOMContentLoaded', async () => {
    requestNotificationPermission();
    await checkMyStatus(); // 初回起動時に権限チェック
    renderFriendList();
    syncFriends();

    document.getElementById('send-btn').onclick = async () => {
        const input = document.getElementById('msg-input');
        if (!input.value.trim() || !currentFriendUUID) return;
        const content = input.value.trim();
        input.value = '';
        await fetch(`${SB_URL}/chat_messages`, { method: 'POST', headers: HEADERS, body: JSON.stringify({ from_uuid: myUUID, to_uuid: currentFriendUUID, content: content }) });
        loadChatHistory(currentFriendUUID, true);
    };

    setInterval(() => { if (currentFriendUUID) loadChatHistory(currentFriendUUID, false); }, 3000);
    setInterval(syncFriends, 10000);
    setInterval(checkMyStatus, 30000); // 30秒ごとに自分の権限が変わったかチェック
});