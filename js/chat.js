import { chat } from './services/index.js';
import { bootstrap, start, pending, stateMessage, showError, confirmAction, notify } from './shared/ui.js';
import { validateImage } from './data/validation.js';
import { renderConversation, renderMessage } from './chat/render.js';

start(async () => {
  const user = await bootstrap(); if (!user) return;
  const area = document.querySelector('.chat-area'), list = document.querySelector('.chat-list'), history = document.querySelector('.messages');
  const input = document.querySelector('.message-input input'), contactSearch = document.querySelector('.search-box input');
  const send = document.querySelector('.send-icon'), attach = document.querySelector('.attachment-btn'), emoji = document.querySelector('.emoji-btn');
  const menuButton = document.querySelector('.menu-btn'), searchButton = document.querySelector('.chat-actions .action-icon:not(.menu-btn)');
  const inputRow = document.querySelector('.message-input');
  let rooms = [], selected = null, records = [], selectionGeneration = 0, refreshGeneration = 0, saving = false;
  const drafts = new Map(), attachments = new Map();
  function iconButton(element, label) { element.setAttribute('aria-label', label); element.style.border = '0'; element.style.background = 'transparent'; element.style.padding = '0'; element.type = 'button'; }
  iconButton(send, 'Ուղարկել հաղորդագրությունը'); iconButton(attach, 'Կցել պատկեր'); iconButton(emoji, 'Ընտրել էմոջի'); iconButton(menuButton, 'Նամակագրության գործողություններ'); iconButton(searchButton, 'Որոնել նամակագրության մեջ');
  input.setAttribute('aria-label', 'Հաղորդագրություն'); input.maxLength = 5000; contactSearch.setAttribute('aria-label', 'Փնտրել զրուցակից');
  const attachmentStatus = document.createElement('div'); attachmentStatus.style.cssText = 'padding:4px 16px;font-size:13px'; inputRow.before(attachmentStatus);
  const messageSearch = document.createElement('input'); messageSearch.type = 'search'; messageSearch.placeholder = 'Որոնել հաղորդագրություններում...'; messageSearch.setAttribute('aria-label', 'Որոնել հաղորդագրություններում');
  messageSearch.style.cssText = 'display:none;width:100%;box-sizing:border-box;padding:10px;border:1px solid var(--border-color);background:var(--card-background);color:var(--font-color-primary)'; history.before(messageSearch);
  searchButton.onclick = () => { const visible = messageSearch.style.display === 'none'; messageSearch.style.display = visible ? 'block' : 'none'; if (visible) messageSearch.focus(); else { messageSearch.value = ''; renderHistory(); } };
  function renderHistory() {
    const filtered = records.filter(record => !messageSearch.value || record.text.toLowerCase().includes(messageSearch.value.toLowerCase()));
    if (!filtered.length) stateMessage(history, messageSearch.value ? 'Հաղորդագրություններ չեն գտնվել' : 'Հաղորդագրություններ չկան');
    else history.innerHTML = filtered.map(record => renderMessage(record, user.id, selected?.isGroup)).join('');
    history.scrollTop = history.scrollHeight;
  }
  messageSearch.oninput = renderHistory;
  function renderList() {
    const filtered = rooms.filter(room => room.name.toLowerCase().includes(contactSearch.value.toLowerCase()));
    if (!filtered.length) stateMessage(list, 'Նամակագրություններ չեն գտնվել');
    else list.innerHTML = filtered.map(room => renderConversation(room, selected?.id)).join('');
  }
  contactSearch.oninput = renderList;
  function updateAttachment() {
    attachmentStatus.replaceChildren();
    const file = selected && attachments.get(selected.id); if (!file) return;
    const text = document.createElement('span'); text.textContent = `📎 ${file.name}`;
    const remove = document.createElement('button'); remove.textContent = 'Հեռացնել'; remove.onclick = () => { attachments.delete(selected.id); updateAttachment(); };
    attachmentStatus.append(text, remove);
  }
  function setHeader() {
    document.querySelector('.contact-name').textContent = selected?.name || 'Ընտրեք նամակագրություն';
    document.querySelector('.contact-info .avatar').textContent = selected ? selected.isGroup ? '👥' : selected.name.slice(0, 1) : '';
    document.querySelector('.contact-status').textContent = selected ? selected.closed ? 'Նամակագրությունն ավարտված է' : selected.blocked ? 'Արգելափակված է' : selected.isGroup ? 'Խմբային նամակագրություն' : 'Անձնական նամակագրություն' : '';
    input.disabled = !selected || selected.blocked || selected.closed || saving; send.disabled = !selected || selected.blocked || selected.closed || saving; attach.disabled = !selected || selected.blocked || selected.closed || saving; menuButton.disabled = !selected;
    renderMenu();
  }
  async function selectRoom(room) {
    if (selected) drafts.set(selected.id, input.value);
    const current = ++selectionGeneration; selected = room; records = []; input.value = drafts.get(room.id) || ''; messageSearch.value = '';
    window.history.replaceState(null, '', `message.html?room=${encodeURIComponent(room.id)}`);
    setHeader(); updateAttachment(); renderList(); stateMessage(history, 'Բեռնվում է...');
    try {
      const messages = await chat.messages(room.id); if (current !== selectionGeneration) return;
      records = messages; renderHistory();
      await chat.read(room.id); room.unreadCount = 0; renderList();
    } catch (error) { if (current === selectionGeneration) stateMessage(history, error.message, { retry: () => selectRoom(room) }); }
  }
  async function refresh() {
    const current = ++refreshGeneration;
    try {
      const latest = await chat.list(); if (current !== refreshGeneration) return;
      rooms = latest; renderList();
      const id = selected?.id || new URLSearchParams(location.search).get('room');
      const target = rooms.find(room => room.id === id) || (!selected && !id ? rooms[0] : null);
      if (!target) { selected = null; records = []; input.value = ''; setHeader(); updateAttachment(); stateMessage(history, id ? 'Նամակագրությունը հասանելի չէ։ Ընտրեք այլ զրուցակից։' : 'Ընտրեք նամակագրություն'); return; }
      if (!selected || selected.id !== target.id) await selectRoom(target);
      else {
        const previousGeneration = selectionGeneration;
        const messages = await chat.messages(target.id);
        if (previousGeneration !== selectionGeneration || current !== refreshGeneration) return;
        selected = target; records = messages; renderHistory(); setHeader();
        if (document.visibilityState !== 'hidden') { await chat.read(target.id); target.unreadCount = 0; renderList(); }
      }
    } catch (error) { stateMessage(list, error.message, { retry: refresh }); }
  }
  list.onclick = event => { const item = event.target.closest('.chat-item'); if (item) selectRoom(rooms.find(room => room.id === item.dataset.roomId)); };
  list.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { const item = event.target.closest('.chat-item'); if (item) { event.preventDefault(); item.click(); } } };
  send.onclick = async () => {
    if (!selected || saving) return;
    const roomId = selected.id, text = input.value, file = attachments.get(roomId);
    saving = true;
    // pending() owns the send button; freeze composer edits during the request.
    input.disabled = true; attach.disabled = true;
    const saved = await pending(send, area, async () => { await chat.send(roomId, { text, file }); });
    saving = false;
    if (saved) { drafts.delete(roomId); attachments.delete(roomId); if (selected?.id === roomId) input.value = ''; }
    setHeader(); updateAttachment(); await refresh();
  };
  input.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); send.click(); } };
  const fileInput = document.createElement('input'); fileInput.type = 'file'; fileInput.accept = 'image/png,image/jpeg,image/webp,image/gif'; fileInput.hidden = true; document.body.appendChild(fileInput);
  attach.onclick = () => fileInput.click();
  fileInput.onchange = () => {
    if (!selected || !fileInput.files[0]) return;
    try { validateImage(fileInput.files[0]); attachments.set(selected.id, fileInput.files[0]); updateAttachment(); }
    catch (error) { showError(area, error); }
    fileInput.value = '';
  };
  const emojiPicker = document.createElement('div'); emojiPicker.style.cssText = 'display:none;position:absolute;bottom:60px;left:20px;background:var(--card-background);border:1px solid var(--border-color);border-radius:8px;padding:10px;grid-template-columns:repeat(5,1fr);gap:5px;z-index:100';
  ['😀','😂','😍','🥺','😎','😭','😡','👍','👎','🎉','❤️','🔥','✅','❌'].forEach(value => { const button = document.createElement('button'); button.textContent = value; button.type = 'button'; button.style.cssText = 'background:transparent;border:0;cursor:pointer;font-size:1.2rem'; button.onclick = () => { if (!input.disabled) { input.value += value; input.focus(); } }; emojiPicker.appendChild(button); });
  inputRow.style.position = 'relative'; inputRow.appendChild(emojiPicker); emoji.onclick = () => { emojiPicker.style.display = emojiPicker.style.display === 'none' ? 'grid' : 'none'; };
  const dropdown = document.createElement('div'); dropdown.className = 'chat-dropdown'; dropdown.style.cssText = 'display:none;position:absolute;top:110%;right:0;background:var(--card-background);border:1px solid var(--border-color);border-radius:8px;box-shadow:0 10px 25px rgba(0,0,0,.15);z-index:100;min-width:180px';
  const closeMenu = () => { dropdown.style.display = 'none'; menuButton.setAttribute('aria-expanded', 'false'); };
  menuButton.setAttribute('aria-expanded', 'false');
  document.querySelector('.chat-actions').style.position = 'relative'; document.querySelector('.chat-actions').appendChild(dropdown);
  function renderMenu() {
    dropdown.replaceChildren(); if (!selected) return;
    const room = selected, peer = room.participants.find(person => person.id !== user.id);
    const actions = [
      ['🗑️', 'Ջնջել նամակագրությունը', async () => { if (!await confirmAction('Հեռացնե՞լ ձեր տեսանելի նամակագրությունը։')) return; await chat.hide(room.id); drafts.delete(room.id); attachments.delete(room.id); selected = null; window.history.replaceState(null, '', 'message.html'); await refresh(); }],
      ['🚫', room.blocked ? 'Ապաարգելափակել' : 'Արգելափակել', async () => { await chat.block(peer.id, !room.blocked); await refresh(); }, room.isGroup || !peer],
      ['👤', 'Դիտել էջը', () => { location.href = `user.html?id=${encodeURIComponent(peer.id)}`; }, room.isGroup || !peer],
      [room.muted ? '🔔' : '🔕', room.muted ? 'Միացնել ծանուցումները' : 'Անջատել ծանուցումները', async () => { await chat.mute(room.id, !room.muted); await refresh(); }],
    ];
    actions.forEach(([icon, name, action, disabled]) => { const button = document.createElement('button'); button.className = 'chat-dropdown-item'; button.textContent = `${icon} ${name}`; button.disabled = Boolean(disabled); button.style.cssText = 'width:100%;border:0;background:transparent;text-align:left;font-family:inherit'; button.onclick = async () => { const done = await pending(button, area, action); if (done) closeMenu(); }; dropdown.appendChild(button); });
  }
  menuButton.onclick = () => { dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none'; menuButton.setAttribute('aria-expanded', String(dropdown.style.display === 'block')); };
  document.addEventListener('click', event => { if (!event.target.closest('.message-input')) emojiPicker.style.display = 'none'; if (!event.target.closest('.chat-actions')) closeMenu(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { closeMenu(); emojiPicker.style.display = 'none'; } });
  history.onclick = event => {
    const button = event.target.closest('.copy-btn'); if (!button) return;
    const message = records.find(record => record.id === button.closest('.message').dataset.messageId);
    pending(button, area, async () => { await navigator.clipboard.writeText(message.text); button.textContent = '✓'; setTimeout(() => { button.textContent = '📋'; }, 1000); });
  };
  setHeader();
  const unsubscribe = await chat.subscribe(event => {
    if (['chat.send','chat.incoming','chat.mute','chat.hide','chat.block','reset'].includes(event.operation)) refresh().catch(error => showError(area, error));
  });
  window.addEventListener('pagehide', event => { if (!event.persisted) unsubscribe(); });
  await refresh();
});
