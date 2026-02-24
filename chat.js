// --- 1. UUIDの管理 (最優先で実行) ---
let isFirstTime = false;
let myUUID = localStorage.getItem('chat_user_uuid');

if (!myUUID) {
    // 初めてのアクセスの場合のみ生成
    myUUID = crypto.randomUUID();
    localStorage.setItem('chat_user_uuid', myUUID);
    isFirstTime = true;
}

// 画面が読み込まれた後、初回のみUUIDを通知する
window.addEventListener('DOMContentLoaded', () => {
    if (isFirstTime) {
        alert(`【初回設定】あなた専用のIDが発行されました。このブラウザに保存されます。\nID: ${myUUID}`);
    }
});

// --- 2. 設定：Supabaseの情報 ---
const SB_URL = 'https://dkyhhoqzphpwwnnwmdzq.supabase.co/rest/v1';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRreWhob3F6cGhwd3dubndtZHpxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE5MzIyMjEsImV4cCI6MjA4NzUwODIyMX0.ZDWsgWzwZFdBGv31njaNL_QkJAjwHPZj6IFutIOlfPk';

const HEADERS = {
    'apikey': SB_KEY,
    'Authorization': `Bearer ${SB_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
    'x-my-uuid': myUUID 
};

// --- 3. 状態管理 ---
let currentFriendUUID = null;
let friends = JSON.parse(localStorage.getItem('chat_friends') || '[]');

// --- 4. メッセージ取得機能 ---
async function loadChatHistory(friendUuid) {
    try {
        const url = `${SB_URL}/chat_messages?select=*&or=(and(from_uuid.eq.${myUUID},to_uuid.eq.${friendUuid}),and(from_uuid.eq.${friendUuid},to_uuid.eq.${myUUID}))&order=created_at.asc`;
        const res = await fetch(url, { headers: HEADERS });
        const history = await res.json();
        
        const container = document.getElementById('chat-container');
        container.innerHTML = '';
        history.forEach(msg => {
            appendMessage(msg.content, msg.from_uuid === myUUID);
        });
    } catch (e) {
        console.error("履歴の取得に失敗しました", e);
    }
}

// 5秒おきに新着確認
setInterval(() => {
    if (currentFriendUUID) loadChatHistory(currentFriendUUID);
}, 5000);

// --- 5. チャット相手の切り替え ---
function selectFriend(uuid, name) {
    currentFriendUUID = uuid;
    document.getElementById('chat-with-name').innerText = `${name} とのチャット`;
    loadChatHistory(uuid);
    renderFriendList();
}

// --- 6. 送信処理 ---
async function sendMessage() {
    const input = document.getElementById('msg-input');
    if (!input.value || !currentFriendUUID) return;

    const body = {
        from_uuid: myUUID,
        to_uuid: currentFriendUUID,
        content: input.value,
        is_image: false 
    };

    try {
        const res = await fetch(`${SB_URL}/chat_messages`, {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify(body)
        });
        
        if (!res.ok) throw new Error("送信権限がありません");

        appendMessage(input.value, true);
        input.value = '';
    } catch (e) {
        alert("送信に失敗しました。相手と相互フレンドか確認してください。");
    }
}

// --- 7. フレンド申請（WeChat方式：承認と同時に有効化） ---
async function addFriend() {
    const codeInput = document.getElementById('friend-code-input');
    const code = codeInput.value.trim().toUpperCase();
    
    if (code.length === 4) {
        try {
            const res = await fetch(`${SB_URL}/friend_codes?code=eq.${code}&select=uuid`, { headers: HEADERS });
            const data = await res.json();
            
            if (data.length > 0 && data[0].uuid) {
                const targetUuid = data[0].uuid;

                // DBにフレンド関係を保存
                await fetch(`${SB_URL}/friend_relations`, {
                    method: 'POST',
                    headers: HEADERS,
                    body: JSON.stringify({ user_a: myUUID, user_b: targetUuid })
                });

                if (!friends.find(f => f.uuid === targetUuid)) {
                    friends.push({ uuid: targetUuid, name: `Friend-${code}` });
                    localStorage.setItem('chat_friends', JSON.stringify(friends));
                }
                
                renderFriendList();
                closeModal();
                alert('フレンドを有効化しました！');
                codeInput.value = '';
            } else {
                alert('コードが見つからないか、期限切れです');
            }
        } catch (e) {
            alert('接続に失敗しました');
        }
    }
}

// --- 8. UI表示系関数 ---
function renderFriendList() {
    const container = document.getElementById('friend-list-container');
    container.innerHTML = '';
    friends.forEach(f => {
        const div = document.createElement('div');
        div.className = `friend-icon ${currentFriendUUID === f.uuid ? 'active' : ''}`;
        div.innerHTML = `<span>👤</span><span class="friend-name">${f.name}</span>`;
        div.onclick = () => selectFriend(f.uuid, f.name);
        container.appendChild(div);
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
    document.getElementById('friend-modal').style.display = 'block';
    document.getElementById('overlay').style.display = 'block';

    const code = Math.floor(1000 + Math.random() * 9000).toString();
    
    await fetch(`${SB_URL}/friend_codes`, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({ code: code, uuid: myUUID })
    });
    
    document.getElementById('my-temp-code').innerText = code;
}

function closeModal() {
    document.getElementById('friend-modal').style.display = 'none';
    document.getElementById('overlay').style.display = 'none';
}

// --- 9. イベントリスナー ---
document.getElementById('send-btn').onclick = sendMessage;
document.getElementById('msg-input').onkeypress = (e) => { 
    if (e.key === 'Enter') sendMessage(); 
};

renderFriendList();