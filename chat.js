// --- 1. ユーザー管理 ---
let isFirstTime = false;
let myUUID = localStorage.getItem('chat_user_uuid');
let myDisplayName = localStorage.getItem('chat_my_name') || "自分";

if (!myUUID) {
    myUUID = crypto.randomUUID();
    localStorage.setItem('chat_user_uuid', myUUID);
    isFirstTime = true;
}

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

// --- 4. メッセージ取得 ---
async function loadChatHistory(friendUuid) {
    if (!friendUuid) return;
    try {
        const filter = `and(from_uuid.eq.${myUUID},to_uuid.eq.${friendUuid}),and(from_uuid.eq.${friendUuid},to_uuid.eq.${myUUID})`;
        const url = `${SB_URL}/chat_messages?select=*&or=(${filter})&order=created_at.asc`;
        const res = await fetch(url, { headers: HEADERS });
        const history = await res.json();
        
        if (!Array.isArray(history)) return;
        const container = document.getElementById('chat-container');
        container.innerHTML = '';
        history.forEach(msg => {
            appendMessage(msg.content, msg.from_uuid === myUUID);
        });
    } catch (e) {
        console.error("履歴取得失敗", e);
    }
}

// --- 5. フレンド同期 ---
async function syncFriends() {
    try {
        const url = `${SB_URL}/friend_relations?or=(user_a.eq.${myUUID},user_b.eq.${myUUID})`;
        const res = await fetch(url, { headers: HEADERS });
        const data = await res.json();

        let updated = false;
        data.forEach(rel => {
            const targetUuid = (rel.user_a === myUUID) ? rel.user_b : rel.user_a;
            if (!friends.find(f => f.uuid === targetUuid)) {
                friends.push({ uuid: targetUuid, name: `User-${targetUuid.substring(0,4)}` });
                updated = true;
            }
        });

        if (updated) {
            localStorage.setItem('chat_friends', JSON.stringify(friends));
            renderFriendList();
        }
    } catch (e) {
        console.error("同期失敗", e);
    }
}

// --- 6. 送信処理 ---
async function sendMessage() {
    const input = document.getElementById('msg-input');
    const content = input.value.trim();
    if (!content || !currentFriendUUID) return;

    try {
        const res = await fetch(`${SB_URL}/chat_messages`, {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify({
                from_uuid: myUUID,
                to_uuid: currentFriendUUID,
                content: content,
                is_image: false 
            })
        });
        if (res.ok) {
            appendMessage(content, true);
            input.value = '';
        }
    } catch (e) {
        alert("送信失敗");
    }
}

// --- 7. 設定・名前変更・削除 ---
function saveMyName() {
    const val = document.getElementById('my-name-input').value.trim();
    if (val) {
        myDisplayName = val;
        localStorage.setItem('chat_my_name', val);
        alert("名前を保存しました。");
    }
}

function deleteFriend(uuid) {
    if (!confirm("フレンドを削除しますか？")) return;
    friends = friends.filter(f => f.uuid !== uuid);
    localStorage.setItem('chat_friends', JSON.stringify(friends));
    
    if (currentFriendUUID === uuid) {
        currentFriendUUID = null;
        document.getElementById('chat-with-name').innerText = "相手を選択してください";
        document.getElementById('chat-container').innerHTML = '';
    }
    renderFriendList();
    renderDeleteFriendList();
}

// --- 8. UI表示・モーダル ---
function renderFriendList() {
    const container = document.getElementById('friend-list-container');
    container.innerHTML = '';
    friends.forEach(f => {
        const div = document.createElement('div');
        div.className = `friend-icon ${currentFriendUUID === f.uuid ? 'active' : ''}`;
        div.innerHTML = `<span>👤</span><span class="friend-name">${f.name}</span>`;
        div.onclick = () => {
            currentFriendUUID = f.uuid;
            document.getElementById('chat-with-name').innerText = `${f.name} とのチャット`;
            loadChatHistory(f.uuid);
            renderFriendList();
        };
        container.appendChild(div);
    });
}

function renderDeleteFriendList() {
    const container = document.getElementById('delete-friend-list');
    container.innerHTML = friends.length ? '' : '<p style="text-align:center;font-size:12px;color:#999;">フレンドがいません</p>';
    friends.forEach(f => {
        const item = document.createElement('div');
        item.className = 'delete-item';
        item.innerHTML = `<span>${f.name}</span><button onclick="deleteFriend('${f.uuid}')" style="background:#e74c3c;color:white;border:none;border-radius:4px;padding:4px 8px;cursor:pointer;">削除</button>`;
        container.appendChild(item);
    });
}

function appendMessage(content, isMe) {
    const container = document.getElementById('chat-container');
    const div = document.createElement('div');
    div.className = `msg ${isMe ? 'me' : 'other'}`;
    div.innerText = content;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

async function showFriendModal() {
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    document.getElementById('my-temp-code').innerText = code;
    document.getElementById('friend-modal').style.display = 'block';
    document.getElementById('overlay').style.display = 'block';
    await fetch(`${SB_URL}/friend_codes`, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({ code: code, uuid: myUUID })
    });
}

function showSettingsModal() {
    document.getElementById('my-name-input').value = myDisplayName;
    renderDeleteFriendList();
    document.getElementById('settings-modal').style.display = 'block';
    document.getElementById('overlay').style.display = 'block';
}

function closeAllModals() {
    document.getElementById('friend-modal').style.display = 'none';
    document.getElementById('settings-modal').style.display = 'none';
    document.getElementById('overlay').style.display = 'none';
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
            await fetch(`${SB_URL}/friend_relations`, {
                method: 'POST',
                headers: HEADERS,
                body: JSON.stringify({ user_a: myUUID, user_b: targetUuid })
            });
            await syncFriends();
            closeAllModals();
            alert("登録しました！");
            codeInput.value = '';
        } else {
            alert("無効なコードです");
        }
    } catch (e) {
        alert("エラーが発生しました");
    }
}

// --- 9. 初期化 ---
window.addEventListener('DOMContentLoaded', () => {
    if (isFirstTime) alert(`ID: ${myUUID}`);
    
    // グローバルに関数を公開 (HTMLから呼べるようにする)
    window.showFriendModal = showFriendModal;
    window.showSettingsModal = showSettingsModal;
    window.closeAllModals = closeAllModals;
    window.addFriend = addFriend;
    window.saveMyName = saveMyName;
    window.deleteFriend = deleteFriend;

    document.getElementById('send-btn').onclick = sendMessage;
    document.getElementById('msg-input').onkeypress = (e) => { 
        if (e.key === 'Enter') sendMessage(); 
    };

    renderFriendList();
    syncFriends();
    setInterval(() => {
        if (currentFriendUUID) loadChatHistory(currentFriendUUID);
        syncFriends();
    }, 5000);
});