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
let pc = null;
let localStream = null;
const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] };

// --- 4. 通話監視ロジック (最優先) ---
async function watchCalls() {
    try {
        // console.log("Polling for calls..."); // Firefoxデバッグ用
        const res = await fetch(`${SB_URL}/friend_calls?to_uuid=eq.${myUUID}&from_uuid=neq.${myUUID}&order=created_at.desc&limit=1`, { headers: HEADERS });
        if (!res.ok) return;
        const data = await res.json();
        
        if (!data || data.length === 0) return;
        const signal = data[0];
        
        // 8秒以上前の古い信号は無視
        const age = Date.now() - new Date(signal.created_at).getTime();
        if (age > 8000) return;

        if (signal.type === 'offer' && !pc) {
            window.incomingOffer = signal;
            showCallUI(signal.from_uuid, true);
        } else if (signal.type === 'answer' && pc) {
            if (pc.signalingState === "have-local-offer") {
                await pc.setRemoteDescription(new RTCSessionDescription(signal.payload));
                document.getElementById('call-status').innerText = "通話中";
            }
        } else if (signal.type === 'candidate' && pc) {
            if (pc.remoteDescription) {
                await pc.addIceCandidate(new RTCIceCandidate(signal.payload)).catch(()=>{});
            }
        } else if (signal.type === 'hangup') {
            endCall(false);
        }
    } catch (e) {
        console.error("Watch Loop Error:", e);
    }
}

// 常に監視を実行
setInterval(watchCalls, 1500);

// --- 5. 通話制御機能 ---
async function setupWebRTC(isCaller, targetUuid) {
    if (pc) return;
    pc = new RTCPeerConnection(rtcConfig);

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    } catch (e) {
        alert("マイクへのアクセスを許可してください");
        return endCall();
    }

    pc.ontrack = (event) => {
        const remoteAudio = document.getElementById('remote-audio');
        if (remoteAudio) remoteAudio.srcObject = event.streams[0];
    };

    pc.onicecandidate = (event) => {
        if (event.candidate) sendCallSignal(targetUuid, 'candidate', event.candidate);
    };

    if (isCaller) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await sendCallSignal(targetUuid, 'offer', offer);
    }
}

async function sendCallSignal(to, type, payload) {
    try {
        await fetch(`${SB_URL}/friend_calls`, {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify({ from_uuid: myUUID, to_uuid: to, type: type, payload: payload })
        });
    } catch (e) { console.error("Signal Send Error:", e); }
}

function showCallUI(targetUuid, isIncoming) {
    const modal = document.getElementById('call-modal');
    const overlay = document.getElementById('overlay');
    const partner = friends.find(f => f.uuid === targetUuid);
    
    document.getElementById('call-partner-name').innerText = partner ? partner.name : `不明なユーザー(${targetUuid.substring(0,4)})`;
    document.getElementById('call-status').innerText = isIncoming ? "着信中..." : "発信中...";
    document.getElementById('call-answer-btn').style.display = isIncoming ? "inline-block" : "none";
    
    modal.style.display = 'block';
    overlay.style.display = 'block';

    document.getElementById('call-answer-btn').onclick = async () => {
        await setupWebRTC(false, targetUuid);
        if (window.incomingOffer) {
            await pc.setRemoteDescription(new RTCSessionDescription(window.incomingOffer.payload));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            await sendCallSignal(targetUuid, 'answer', answer);
            document.getElementById('call-status').innerText = "通話中";
            document.getElementById('call-answer-btn').style.display = 'none';
        }
    };
}

function endCall(sendSignal = true) {
    if (sendSignal) {
        const target = currentFriendUUID || (window.incomingOffer ? window.incomingOffer.from_uuid : null);
        if (target) sendCallSignal(target, 'hangup', {});
    }
    if (pc) { pc.close(); pc = null; }
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
    const remoteAudio = document.getElementById('remote-audio');
    if (remoteAudio) remoteAudio.srcObject = null;
    window.incomingOffer = null;
    closeAllModals();
}

// --- 6. 名前・フレンド管理 ---
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
        
        let updated = false;
        // リストにいないUUIDがあれば追加
        for (const uid of dbUuids) {
            if (!friends.find(f => f.uuid === uid)) {
                const name = await getFriendName(uid);
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

// --- 7. UI描画 ---
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
            document.getElementById('call-start-btn').style.display = 'block';
            document.getElementById('chat-container').innerHTML = '';
            renderFriendList();
            loadChatHistory(f.uuid);
        };
        container.appendChild(div);
    });
}

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

// --- 8. 窓口アクション ---
window.deleteFriend = async (uuid) => {
    if (!confirm("削除しますか？")) return;
    const query = `or=(and(user_a.eq.${myUUID},user_b.eq.${uuid}),and(user_a.eq.${uuid},user_b.eq.${myUUID}))`;
    await fetch(`${SB_URL}/friend_relations?${query}`, { method: 'DELETE', headers: HEADERS });
    friends = friends.filter(f => f.uuid !== uuid);
    localStorage.setItem('chat_friends', JSON.stringify(friends));
    if (currentFriendUUID === uuid) { currentFriendUUID = null; document.getElementById('call-start-btn').style.display = 'none'; }
    renderFriendList(); renderDeleteFriendList();
};

window.saveMyName = async () => {
    const val = document.getElementById('my-name-input').value.trim();
    if (val) { myDisplayName = val; localStorage.setItem('chat_my_name', val); await pushNameToDB(val); closeAllModals(); syncFriends(); }
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

// --- 9. DOM読込後の初期化 ---
window.addEventListener('DOMContentLoaded', () => {
    pushNameToDB(myDisplayName);
    
    document.getElementById('send-btn').onclick = async () => {
        const input = document.getElementById('msg-input');
        if (!input.value.trim() || !currentFriendUUID) return;
        await fetch(`${SB_URL}/chat_messages`, { method: 'POST', headers: HEADERS, body: JSON.stringify({ from_uuid: myUUID, to_uuid: currentFriendUUID, content: input.value.trim() }) });
        input.value = '';
        loadChatHistory(currentFriendUUID);
    };

    document.getElementById('call-start-btn').onclick = () => {
        if (currentFriendUUID) {
            showCallUI(currentFriendUUID, false);
            setupWebRTC(true, currentFriendUUID);
        }
    };

    document.getElementById('call-hangup-btn').onclick = () => endCall(true);

    renderFriendList();
    syncFriends();

    // 定期更新
    setInterval(() => { if (currentFriendUUID) loadChatHistory(currentFriendUUID); }, 4000);
    setInterval(syncFriends, 10000);
});