// --- 1. ユーザー管理 ---
let myUUID = localStorage.getItem('chat_user_uuid') || crypto.randomUUID();
localStorage.setItem('chat_user_uuid', myUUID);
let myDisplayName = localStorage.getItem('chat_my_name') || "自分";

// --- 2. Supabase設定 ---
const SB_URL = 'https://dkyhhoqzphpwwnnwmdzq.supabase.co/rest/v1';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRreWhob3F6cGhwd3dubndtZHpxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE5MzIyMjEsImV4cCI6MjA4NzUwODIyMX0.ZDWsgWzwZFdBGv31njaNL_QkJAjwHPZj6IFutIOlfPk';
const HEADERS = {
    'apikey': SB_KEY,
    'Authorization': `Bearer ${SB_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
};

// --- 3. 状態管理 ---
let currentFriendUUID = null;
let friends = JSON.parse(localStorage.getItem('chat_friends') || '[]');
let lastMsgCount = 0;

// --- 4. 名前管理機能 ---
async function pushNameToDB(name) {
    try {
        await fetch(`${SB_URL}/users`, {
            method: 'POST',
            headers: { ...HEADERS, 'Prefer': 'resolution=merge-duplicates' },
            body: JSON.stringify({ uuid: myUUID, display_name: name }),
        });
    } catch (e) { console.error("Name push failed", e); }
}

async function getFriendName(uuid) {
    try {
        const res = await fetch(`${SB_URL}/users?uuid=eq.${uuid}&select=display_name`, { headers: HEADERS });
        const data = await res.json();
        return (data.length > 0 && data[0].display_name) ? data[0].display_name : `User-${uuid.substring(0,4)}`;
    } catch (e) { return `User-${uuid.substring(0,4)}`; }
}

// --- 5. メッセージ取得 ---
async function loadChatHistory(friendUuid) {
    if (!friendUuid) return;
    try {
        const filter = `and(from_uuid.eq.${myUUID},to_uuid.eq.${friendUuid}),and(from_uuid.eq.${friendUuid},to_uuid.eq.${myUUID})`;
        const url = `${SB_URL}/chat_messages?select=*&or=(${filter})&order=created_at.asc`;
        const res = await fetch(url, { headers: HEADERS });
        const history = await res.json();
        
        if (!Array.isArray(history)) return;
        
        if (history.length !== lastMsgCount) {
            const container = document.getElementById('chat-container');
            container.innerHTML = '';
            history.forEach(msg => appendMessage(msg.content, msg.from_uuid === myUUID));
            lastMsgCount = history.length;
            container.scrollTop = container.scrollHeight;
        }
    } catch (e) { console.error("Load chat failed", e); }
}

// --- 6. フレンド同期 (自分排除 & 削除反映) ---
async function syncFriends() {
    try {
        const url = `${SB_URL}/friend_relations?or=(user_a.eq.${myUUID},user_b.eq.${myUUID})`;
        const res = await fetch(url, { headers: HEADERS });
        const data = await res.json();
        
        // DBにある最新のUUIDリスト（自分自身は除外）
        const dbFriendUuids = data
            .map(rel => (rel.user_a === myUUID) ? rel.user_b : rel.user_a)
            .filter(uuid => uuid !== myUUID); 
        
        let updated = false;

        // 1. DBにいない人をローカルから消す（削除の反映）
        const oldLength = friends.length;
        friends = friends.filter(f => dbFriendUuids.includes(f.uuid));
        if (friends.length !== oldLength) updated = true;

        // 2. 新規追加 or 名前更新
        for (const targetUuid of dbFriendUuids) {
            let existingIdx = friends.findIndex(f => f.uuid === targetUuid);
            const latestName = await getFriendName(targetUuid);

            if (existingIdx === -1) {
                friends.push({ uuid: targetUuid, name: latestName });
                updated = true;
            } else if (friends[existingIdx].name !== latestName) {
                friends[existingIdx].name = latestName;
                updated = true;
            }
        }

        if (updated) {
            localStorage.setItem('chat_friends', JSON.stringify(friends));
            renderFriendList();
        }
    } catch (e) { console.error("Sync failed", e); }
}

// --- 7. 送信・設定・削除 ---
async function sendMessage() {
    const input = document.getElementById('msg-input');
    const content = input.value.trim();
    if (!content || !currentFriendUUID) return;
    try {
        await fetch(`${SB_URL}/chat_messages`, {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify({ from_uuid: myUUID, to_uuid: currentFriendUUID, content: content, is_image: false })
        });
        input.value = '';
        loadChatHistory(currentFriendUUID);
    } catch (e) { alert("送信失敗"); }
}

async function saveMyName() {
    const val = document.getElementById('my-name-input').value.trim();
    if (val) {
        myDisplayName = val;
        localStorage.setItem('chat_my_name', val);
        await pushNameToDB(val);
        alert("名前を保存しました。");
        closeAllModals();
        syncFriends(); 
    }
}

async function deleteFriend(uuid) {
    if (!confirm("お互いのリストから削除されます。よろしいですか？")) return;
    try {
        // DBからフレンド関係を削除 (フィルタリングをor(and,and)形式に修正)
        const query = `or(and(user_a.eq.${myUUID},user_b.eq.${uuid}),and(user_a.eq.${uuid},user_b.eq.${myUUID}))`;
        const res = await fetch(`${SB_URL}/friend_relations?${query}`, {
            method: 'DELETE',
            headers: HEADERS
        });

        if (!res.ok) throw new Error("Delete failed");

        // ローカルからも即削除
        friends = friends.filter(f => f.uuid !== uuid);
        localStorage.setItem('chat_friends', JSON.stringify(friends));
        
        if (currentFriendUUID === uuid) {
            currentFriendUUID = null;
            lastMsgCount = 0;
            document.getElementById('chat-with-name').innerText = "相手を選択してください";
            document.getElementById('chat-container').innerHTML = '';
        }
        renderFriendList();
        renderDeleteFriendList();
    } catch (e) { 
        console.error(e);
        alert("削除に失敗しました"); 
    }
}

// --- 8. UI描画 ---
function renderFriendList() {
    const container = document.getElementById('friend-list-container');
    container.innerHTML = '';
    friends.forEach(f => {
        const div = document.createElement('div');
        div.className = `friend-icon ${currentFriendUUID === f.uuid ? 'active' : ''}`;
        div.innerHTML = `<span>👤</span><span class="friend-name">${f.name}</span>`;
        div.onclick = () => {
            if (currentFriendUUID === f.uuid) return;
            currentFriendUUID = f.uuid;
            lastMsgCount = 0;
            document.getElementById('chat-with-name').innerText = `${f.name} とのチャット`;
            document.getElementById('chat-container').innerHTML = ''; // 一旦クリア
            loadChatHistory(f.uuid);
            renderFriendList();
        };
        container.appendChild(div);
    });
}

function renderDeleteFriendList() {
    const container = document.getElementById('delete-friend-list');
    if(!container) return;
    container.innerHTML = friends.length ? '' : '<p style="text-align:center;font-size:12px;color:#999;padding:10px;">フレンドはいません</p>';
    friends.forEach(f => {
        const item = document.createElement('div');
        item.className = 'delete-item';
        item.style = "display:flex; justify-content:space-between; align-items:center; padding:10px; border-bottom:1px solid #eee;";
        item.innerHTML = `<span>${f.name}</span><button onclick="deleteFriend('${f.uuid}')" style="background:#e74c3c;color:white;border:none;border-radius:4px;padding:4px 10px;cursor:pointer;">削除</button>`;
        container.appendChild(item);
    });
}

function appendMessage(content, isMe) {
    const container = document.getElementById('chat-container');
    const div = document.createElement('div');
    div.className = `msg ${isMe ? 'me' : 'other'}`;
    div.innerText = content;
    container.appendChild(div);
}

// モーダル
async function showFriendModal() {
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    document.getElementById('my-temp-code').innerText = code;
    document.getElementById('friend-modal').style.display = 'block';
    document.getElementById('overlay').style.display = 'block';
    // コードをDBに登録
    await fetch(`${SB_URL}/friend_codes`, { method: 'POST', headers: HEADERS, body: JSON.stringify({ code: code, uuid: myUUID }) });
}

function showSettingsModal() {
    document.getElementById('my-name-input').value = myDisplayName;
    renderDeleteFriendList();
    document.getElementById('settings-modal').style.display = 'block';
    document.getElementById('overlay').style.display = 'block';
}

function closeAllModals() {
    document.querySelectorAll('.modal, .overlay').forEach(el => el.style.display = 'none');
}

async function addFriend() {
    const codeInput = document.getElementById('friend-code-input');
    const code = codeInput.value.trim().toUpperCase();
    if (code.length !== 4) return;
    try {
        const res = await fetch(`${SB_URL}/friend_codes?code=eq.${code}&select=uuid`, { headers: HEADERS });
        const data = await res.json();
        if (data.length > 0) {
            const targetUuid = data[0].uuid;
            if (targetUuid === myUUID) {
                alert("自分自身は登録できません");
                return;
            }
            // 重複チェックなしでPOST（DB側の一致で同期させる）
            await fetch(`${SB_URL}/friend_relations`, { 
                method: 'POST', 
                headers: HEADERS, 
                body: JSON.stringify({ user_a: myUUID, user_b: targetUuid }) 
            });
            await syncFriends();
            codeInput.value = '';
            closeAllModals();
        } else {
            alert("コードが見つかりません");
        }
    } catch (e) { alert("申請エラー"); }
}

// --- 9. 初期化 ---
window.addEventListener('DOMContentLoaded', async () => {
    await pushNameToDB(myDisplayName);
    
    // HTMLからの呼び出し用
    window.showFriendModal = showFriendModal;
    window.showSettingsModal = showSettingsModal;
    window.closeAllModals = closeAllModals;
    window.addFriend = addFriend;
    window.saveMyName = saveMyName;
    window.deleteFriend = deleteFriend;

    document.getElementById('send-btn').onclick = sendMessage;
    document.getElementById('msg-input').onkeypress = (e) => { if (e.key === 'Enter') sendMessage(); };

    renderFriendList();
    syncFriends();
    
    setInterval(() => {
        if (currentFriendUUID) loadChatHistory(currentFriendUUID);
        syncFriends();
    }, 4000);
});