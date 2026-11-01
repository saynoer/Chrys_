'use strict'
const $ = (id) => document.getElementById(id)
const state = {
  projects: [],
  project: 'shiping',
  view: 'documents',
  trash: false,
  query: '',
  docs: [],
  status: null,
  csrf: '',
  dirty: false,
  editor: null,
  sequence: 0,
  docSequence: 0,
  collection: null
}
const views = {
  documents: ['资料库', '管理原文，让每一次检索都有据可循。', '▤'],
  chunks: ['分片浏览', '查看正文如何被切分，以及每个片段的来源。', '▦'],
  search: ['检索测试', '输入一个问题，查看知识库实际找到了什么。', '⌕'],
  tasks: ['索引任务', '查看资料索引的当前状态，处理失败并重新建立。', '◷'],
  backups: ['备份与恢复', '保存原文与源文件，让知识可以安心积累。', '↧'],
  services: ['服务与集合', '检查本机连接，浏览已有向量集合中的记录。', '◎']
}
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith('on'))
      node.addEventListener(key.slice(2), (event) => {
        try {
          Promise.resolve(value(event)).catch(showError)
        } catch (e) {
          showError(e)
        }
      })
    else if (key === 'class') node.className = value
    else if (key === 'text') node.textContent = value
    else if (key === 'checked' || key === 'disabled' || key === 'hidden') node[key] = Boolean(value)
    else if (value !== undefined && value !== null) node.setAttribute(key, String(value))
  }
  for (const child of children.flat(Infinity))
    if (child !== null && child !== undefined && child !== false)
      node.append(child instanceof Node ? child : String(child))
  return node
}
const button = (label, click, cls = '') =>
  el('button', { type: 'button', class: cls, onclick: click }, label)
const muted = (text) => el('p', { class: 'muted' }, text)
const number = (n) => (typeof n === 'number' ? n.toLocaleString('zh-CN') : '—')
const time = (n) =>
  n
    ? new Date(n).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      })
    : '—'
const project = () => state.projects.find((p) => p.id === state.project)
const base = () => `/api/projects/${encodeURIComponent(state.project)}`
let toastTimer,
  searchTimer,
  polling = false
function toast(text, error = false) {
  $('toast').textContent = text
  $('toast').className = 'toast' + (error ? ' error' : '')
  $('toast').hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    $('toast').hidden = true
  }, 4500)
}
function showError(error) {
  const n = $('notice')
  n.replaceChildren(
    el('span', { text: error.message ?? String(error) }),
    button(
      '关闭',
      () => {
        n.hidden = true
      },
      'quiet small'
    )
  )
  n.hidden = false
}
function clearError() {
  $('notice').hidden = true
}
async function api(route, method = 'GET', body) {
  const response = await fetch(route, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Rag-CSRF': state.csrf },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(90_000)
  })
  const value = await response.json().catch(() => ({ error: '服务返回了无法读取的内容' }))
  if (!response.ok) {
    const e = new Error(value.error ?? '操作失败')
    e.status = response.status
    throw e
  }
  return value
}
function ask(title, message, options = {}) {
  const dialog = $('confirm-dialog'),
    input = options.input
      ? el('input', {
          placeholder: options.placeholder ?? '',
          maxlength: '80',
          value: options.value ?? '',
          'aria-label': options.input
        })
      : null
  return new Promise((resolve) => {
    const form = el(
      'form',
      {
        onsubmit: (e) => {
          e.preventDefault()
          if (input && !input.value.trim()) {
            input.focus()
            return
          }
          dialog.returnValue = 'yes'
          dialog.close()
        }
      },
      el('h2', {}, title),
      el('p', {}, message),
      input,
      el(
        'div',
        { class: 'dialog-actions' },
        button('取消', () => {
          dialog.returnValue = 'no'
          dialog.close()
        }),
        el('button', { class: 'primary', type: 'submit' }, options.ok ?? '确认')
      )
    )
    dialog.replaceChildren(form)
    dialog.returnValue = ''
    dialog.onclose = () => {
      dialog.onclose = null
      resolve(dialog.returnValue === 'yes' ? (input ? input.value.trim() : true) : false)
    }
    dialog.showModal()
    if (input) input.focus()
  })
}
async function discard() {
  if (state.editor?.saving) {
    toast('正在保存，请稍候')
    return false
  }
  return (
    !state.dirty ||
    (await ask('还有未保存的修改', '放弃后，这次编辑的内容不会保存。', { ok: '放弃更改' }))
  )
}
function closeDrawer() {
  $('drawer').hidden = true
  $('drawer-backdrop').hidden = true
  state.editor = null
  state.dirty = false
  state.docSequence++
}
async function navigate(view, id = state.project) {
  if (!(await discard())) return
  closeDrawer()
  clearError()
  state.sequence++
  state.view = view
  if (id !== state.project) {
    state.project = id
    state.query = ''
    state.trash = false
    state.status = null
    state.docs = []
  }
  renderSidebar()
  renderView()
  await refreshView()
}
function renderSidebar() {
  const pList = el(
    'div',
    { class: 'project-list' },
    state.projects.map((p) =>
      button(
        el('strong', {}, p.name),
        () => navigate('documents', p.id),
        'side-project' + (p.id === state.project ? ' active' : '')
      )
    )
  )
  for (let i = 0; i < state.projects.length; i++)
    pList.children[i].append(
      el(
        'small',
        {},
        state.projects[i].connected === false ? '未连接' : number(state.projects[i].documents)
      )
    )
  $('sidebar').replaceChildren(
    el(
      'div',
      { class: 'brand' },
      el('span', { class: 'brand-symbol' }, 'C'),
      el('div', {}, el('strong', {}, 'Chrys'), el('small', {}, 'LOCAL KNOWLEDGE'))
    ),
    el('div', { class: 'side-label' }, '知识库'),
    pList,
    button('＋ 新建知识库', createProject, 'side-add'),
    el(
      'nav',
      { class: 'nav' },
      Object.entries(views).map(([key, value]) =>
        button(
          [el('span', { class: 'nav-icon' }, value[2]), value[0]],
          () => navigate(key),
          'nav-button' + (state.view === key ? ' active' : '')
        )
      )
    ),
    el('div', { class: 'side-footer' }, el('span', {}, '本机工作空间'), '原文与向量保存在这台电脑')
  )
}
async function loadProjects() {
  state.projects = await api('/api/projects')
  if (!project()) state.project = state.projects[0]?.id ?? 'shiping'
  renderSidebar()
}
async function createProject() {
  if (!(await discard())) return
  closeDrawer()
  const name = await ask('新建知识库', '为另一个项目准备独立的资料与检索空间。', {
    input: '知识库名称',
    placeholder: '例如：产品资料、学习笔记',
    ok: '创建知识库'
  })
  if (!name) return
  const p = await api('/api/projects', 'POST', { name })
  await loadProjects()
  await navigate('documents', p.id)
  toast('知识库已创建，可以添加资料了')
}
function statePill(status = state.status) {
  const map = { ready: '索引就绪', indexing: '正在更新', error: '需要处理', idle: '尚未建立' }
  return el(
    'span',
    { class: 'pill ' + (status?.state ?? 'idle') },
    map[status?.state] ?? '等待连接'
  )
}
function heading() {
  const v = views[state.view]
  $('crumb').textContent = v[0]
  return el(
    'section',
    { class: 'page-heading' },
    el(
      'div',
      {},
      el('h1', {}, v[0]),
      muted((state.view === 'services' ? '' : (project()?.name ?? '知识库') + ' · ') + v[1])
    ),
    state.view === 'services'
      ? button('刷新连接', refreshView)
      : el(
          'div',
          { class: 'heading-actions' },
          el('span', { id: 'status-badge' }, statePill()),
          button('建立 / 更新索引', rebuild, 'small')
        )
  )
}
function empty(title, description, action) {
  return el(
    'div',
    { class: 'empty' },
    el('span', { class: 'empty-symbol' }, '▤'),
    el('strong', {}, title),
    el('p', {}, description),
    action ?? null
  )
}
function renderView() {
  const content = $('content')
  content.replaceChildren(heading())
  if (state.view === 'documents') {
    content.append(
      el('div', { class: 'stats', id: 'stats' }),
      el(
        'section',
        { class: 'panel' },
        el(
          'div',
          { class: 'toolbar' },
          el(
            'div',
            { class: 'toolbar-group' },
            el('input', {
              class: 'search-input',
              placeholder: '搜索名称、正文或标签…',
              value: state.query,
              'aria-label': '搜索资料',
              oninput: (e) => {
                state.query = e.target.value
                clearTimeout(searchTimer)
                searchTimer = setTimeout(() => loadDocuments().catch(showError), 300)
              }
            }),
            button(
              '全部资料',
              () => setTrash(false),
              'tab-toggle' + (!state.trash ? ' active' : '')
            ),
            button('回收站', () => setTrash(true), 'tab-toggle' + (state.trash ? ' active' : ''))
          ),
          el(
            'div',
            { class: 'toolbar-group' },
            button('上传文件', uploadFiles),
            button('＋ 新建文本', () => openEditor(), 'primary')
          )
        ),
        el(
          'div',
          { class: 'table-wrap', id: 'doc-table' },
          el('div', { class: 'busy-text' }, '正在读取资料…')
        ),
        el(
          'div',
          { class: 'table-footer' },
          el('span', { id: 'doc-count' }),
          el('span', {}, 'PDF · DOCX · Markdown · TXT')
        )
      ),
      el(
        'p',
        { class: 'upload-note' },
        '原始文件完整保留。保存正文后自动更新索引；删除的资料可以从回收站恢复。'
      )
    )
    updateStats()
  } else if (state.view === 'chunks')
    content.append(
      el(
        'section',
        { class: 'panel panel-padded' },
        el(
          'div',
          { class: 'toolbar-group' },
          el('label', { for: 'chunk-doc' }, '选择资料'),
          el('select', {
            id: 'chunk-doc',
            class: 'plain-select',
            onchange: (e) => loadChunks(e.target.value, $('chunks-body'))
          })
        ),
        el(
          'div',
          { class: 'hint' },
          '分片来自已保存的正文。要修改片段，请编辑对应原文，保存后会同步更新。'
        ),
        el('div', { id: 'chunks-body' })
      )
    )
  else if (state.view === 'search') renderSearch(content)
  else if (state.view === 'tasks')
    content.append(
      el('section', { class: 'panel', id: 'task-body' }),
      el(
        'div',
        { class: 'hint' },
        '新增、修改、恢复或移入回收站后，索引会自动更新。索引失败不会删除原文；修复服务连接后可以重试。'
      )
    )
  else if (state.view === 'backups') renderBackup(content)
  else if (state.view === 'services')
    content.append(
      el('div', { class: 'service-grid', id: 'service-grid' }),
      el('div', { class: 'section-row' }, el('h2', {}, '底层向量集合'), muted('只读浏览')),
      el('section', { class: 'panel', id: 'collection-list' }),
      el(
        'div',
        { class: 'hint' },
        '原始资料通过左侧知识库维护。未由本后台托管的集合保留只读，避免影响其他项目。'
      ),
      el('div', { id: 'collection-records' })
    )
}
async function refreshView() {
  const view = state.view,
    id = state.project,
    seq = state.sequence
  if (view === 'services') {
    await loadServices()
    return
  }
  if (view === 'documents') await loadDocuments()
  if (view === 'chunks') {
    const docs = await api(base() + '/documents')
    if (seq !== state.sequence) return
    const select = $('chunk-doc')
    select.replaceChildren(...docs.map((d) => el('option', { value: d.id }, d.name)))
    if (docs.length) await loadChunks(docs[0].id, $('chunks-body'))
    else
      $('chunks-body').replaceChildren(
        empty(
          '还没有可浏览的分片',
          '添加资料后即可查看切分结果。',
          button('添加资料', () => navigate('documents'))
        )
      )
  }
  if (id === state.project && view === state.view) await loadStatus()
}
async function setTrash(value) {
  state.trash = value
  renderView()
  await loadDocuments()
}
function updateStats() {
  if (!$('stats')) return
  $('stats').replaceChildren(
    ...[
      ['资料总数', project()?.documents, '份'],
      ['当前列表正文', state.docs.reduce((n, d) => n + d.chars, 0), '字符'],
      ['已索引片段', state.status?.chunks, '片']
    ].map(([label, value, unit]) =>
      el(
        'div',
        { class: 'stat' },
        el('span', { class: 'stat-label' }, label),
        el('div', { class: 'stat-value' }, number(value), el('small', {}, unit))
      )
    )
  )
}
async function loadDocuments() {
  const id = state.project,
    q = state.query,
    trash = state.trash,
    seq = ++state.sequence
  try {
    const docs = await api(
      base() + `/documents?trash=${trash ? '1' : '0'}&q=${encodeURIComponent(q)}`
    )
    if (seq !== state.sequence || id !== state.project || state.view !== 'documents') return
    state.docs = docs
    drawDocuments()
    updateStats()
  } catch (e) {
    if (seq !== state.sequence || id !== state.project || state.view !== 'documents') return
    $('doc-table').replaceChildren(
      empty('暂时无法读取资料', e.message, button('重试连接', refreshView))
    )
    $('doc-count').textContent = '资料保持原样'
    throw e
  }
}
function drawDocuments() {
  const target = $('doc-table')
  if (!target) return
  $('doc-count').textContent = `共 ${state.docs.length} 份${state.trash ? '已移除资料' : '资料'}`
  if (!state.docs.length) {
    target.replaceChildren(
      empty(
        state.trash ? '回收站是空的' : '从第一份资料开始',
        state.query
          ? '换个关键词试试。'
          : state.trash
            ? '移除的资料会保留在这里。'
            : '上传文件，或者直接写下希望知识库记住的内容。',
        !state.trash && !state.query ? button('＋ 新建文本', () => openEditor(), 'primary') : null
      )
    )
    return
  }
  const tbody = el(
    'tbody',
    {},
    state.docs.map((d) =>
      el(
        'tr',
        {},
        el(
          'td',
          {},
          el(
            'div',
            { class: 'doc-name' },
            el(
              'span',
              { class: 'file-icon' },
              d.source?.split('.').pop()?.slice(0, 4).toUpperCase() ?? 'TXT'
            ),
            el(
              'div',
              {},
              button(d.name, () => openEditor(d.id), 'doc-title'),
              el('span', { class: 'doc-source' }, d.source ?? '手动创建的文本')
            )
          )
        ),
        el('td', {}, number(d.chars)),
        el(
          'td',
          {},
          d.tags?.length
            ? d.tags.map((t) => el('span', { class: 'tag' }, t))
            : el('span', { class: 'collection-note' }, '—')
        ),
        el('td', {}, time(d.updatedAt)),
        el(
          'td',
          {},
          el(
            'div',
            { class: 'row-actions' },
            state.trash
              ? button('恢复', () => restoreDoc(d), 'small')
              : [
                  button('编辑', () => openEditor(d.id), 'small quiet'),
                  button('移除', () => trashDoc(d), 'small quiet')
                ]
          )
        )
      )
    )
  )
  target.replaceChildren(
    el(
      'table',
      {},
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          ['资料名称', '字符数', '标签', '更新时间', '操作'].map((x) => el('th', {}, x))
        )
      ),
      tbody
    )
  )
}
async function afterChange(message) {
  clearError()
  await loadProjects()
  await loadStatus()
  if (state.view === 'documents') await loadDocuments()
  toast(message)
}
async function trashDoc(doc) {
  if (
    !(await ask('移入回收站', `“${doc.name}”会停止参与检索，原文和源文件仍可恢复。`, {
      ok: '移入回收站'
    }))
  )
    return
  await api(base() + '/documents/' + doc.id, 'DELETE', { version: doc.version })
  await afterChange('资料已移入回收站')
}
async function restoreDoc(doc) {
  await api(base() + '/documents/' + doc.id + '/restore', 'POST', { version: doc.version })
  await afterChange('资料已恢复，正在更新索引')
}
async function openEditor(id) {
  if (!(await discard())) return
  const seq = ++state.docSequence,
    p = state.project
  const doc = id ? await api(base() + '/documents/' + id) : null
  if (seq !== state.docSequence || p !== state.project) return
  state.dirty = false
  const name = el('input', {
      value: doc?.name ?? '',
      maxlength: '80',
      placeholder: '给资料起个名字',
      'aria-label': '资料名称'
    }),
    tags = el('input', {
      value: doc?.tags?.join('，') ?? '',
      placeholder: '例如：课程，项目，面试',
      'aria-label': '资料标签'
    })
  const text = el('textarea', { spellcheck: 'false', 'aria-label': '资料正文' })
  text.value = doc?.text ?? ''
  const count = el('span', {}, number(text.value.length) + ' 字符'),
    saved = el('span', {}, doc ? '已保存 · ' + time(doc.updatedAt) : '新建文本')
  const conv = el('input', {
      type: 'checkbox',
      checked: doc ? doc.modes.includes('conversation') : true
    }),
    screen = el('input', {
      type: 'checkbox',
      checked: doc ? doc.modes.includes('screenshot') : true
    })
  const dirty = () => {
    if (state.editor?.text !== text) return
    state.editor.generation++
    state.dirty = true
    saved.textContent = '有未保存的修改'
    count.textContent = number(text.value.length) + ' 字符'
  }
  for (const field of [name, tags, text, conv, screen]) field.addEventListener('input', dirty)
  const preview = el('div', { class: 'chunk-list' }),
    save = button(doc?.deletedAt ? '已在回收站' : '保存并更新索引', saveEditor, 'primary')
  const body = el(
    'div',
    { class: 'drawer-body' },
    el(
      'div',
      { class: 'form-row' },
      el('div', { class: 'form-field' }, el('label', {}, '资料名称'), name),
      el('div', { class: 'form-field' }, el('label', {}, '标签（用逗号分隔）'), tags)
    ),
    el('div', { class: 'field-label' }, '参与检索的场景'),
    el('div', { class: 'checks' }, el('label', {}, conv, '对话'), el('label', {}, screen, '截图')),
    el(
      'div',
      { class: 'form-field' },
      el('label', {}, '正文'),
      text,
      el('div', { class: 'editor-meta' }, count, saved)
    ),
    doc?.source
      ? el(
          'div',
          { class: 'hint' },
          `原文件：${doc.source}。原文件保留上传时的版本，编辑正文不会改写原文件。`
        )
      : null,
    doc
      ? el(
          'div',
          { class: 'toolbar-group' },
          el(
            'a',
            { href: base() + '/documents/' + doc.id + '/original' },
            doc.hasOriginal ? '下载原始文件' : '下载正文'
          ),
          button('查看已保存分片', () => loadChunks(doc.id, preview), 'small')
        )
      : null,
    el('div', { id: 'editor-error' }),
    preview
  )
  if (doc?.deletedAt) {
    for (const field of [name, tags, text, conv, screen]) field.disabled = true
    save.disabled = true
  }
  state.editor = {
    doc,
    name,
    tags,
    text,
    conv,
    screen,
    save,
    saved,
    project: p,
    generation: 0,
    saving: false
  }
  $('drawer').replaceChildren(
    el(
      'div',
      { class: 'drawer-head' },
      el(
        'div',
        {},
        el('h2', {}, doc?.deletedAt ? '回收站资料' : doc ? '编辑资料' : '新建文本'),
        muted(doc ? '原文、来源与分片' : '保存后自动构建检索索引')
      ),
      button(
        '关闭',
        async () => {
          if (await discard()) closeDrawer()
        },
        'quiet'
      )
    ),
    body,
    el(
      'div',
      { class: 'drawer-foot' },
      muted('原文保存在本机'),
      el(
        'div',
        { class: 'toolbar-group' },
        button('取消', async () => {
          if (await discard()) closeDrawer()
        }),
        save
      )
    )
  )
  $('drawer').hidden = false
  $('drawer-backdrop').hidden = false
  name.focus()
}
async function saveEditor() {
  const e = state.editor
  if (!e || e.project !== state.project || e.saving) return
  const submittedGeneration = e.generation
  const value = {
    name: e.name.value,
    text: e.text.value,
    tags: e.tags.value
      .split(/[,，]/)
      .map((x) => x.trim())
      .filter(Boolean),
    modes: [e.conv.checked ? 'conversation' : null, e.screen.checked ? 'screenshot' : null].filter(
      Boolean
    ),
    ...(e.doc ? { version: e.doc.version } : {})
  }
  e.save.disabled = true
  e.saving = true
  try {
    const doc = await api(
      base() + '/documents' + (e.doc ? '/' + e.doc.id : ''),
      e.doc ? 'PUT' : 'POST',
      value
    )
    if (state.editor !== e || state.project !== e.project) return
    e.doc = doc
    const unchanged = e.generation === submittedGeneration
    state.dirty = !unchanged
    e.saved.textContent = unchanged
      ? '已保存 · ' + time(doc.updatedAt)
      : '上次提交已保存，当前修改尚未保存'
    if (unchanged) {
      e.name.value = doc.name
      e.text.value = doc.text
    }
    $('editor-error').replaceChildren()
    await afterChange(
      unchanged ? '正文已保存，索引正在更新' : '上次提交已保存，继续输入的内容尚未保存'
    )
  } catch (error) {
    if (state.editor !== e || state.project !== e.project) return
    const note = el(
      'div',
      { class: 'error-box' },
      error.status === 409
        ? '资料已在其他位置修改。你的编辑仍保留在这里，请先复制需要保留的内容，再重新加载最新版本。'
        : error.message
    )
    if (error.status === 409)
      note.append(button('重新加载资料', () => openEditor(e.doc.id), 'small'))
    $('editor-error')?.replaceChildren(note)
  } finally {
    e.saving = false
    e.save.disabled = false
  }
}
function chooseFile(accept, multiple = false) {
  return new Promise((resolve) => {
    const input = el('input', {
      type: 'file',
      accept,
      multiple: multiple ? '' : undefined,
      hidden: true
    })
    input.addEventListener(
      'change',
      () => {
        const files = [...input.files]
        input.remove()
        resolve(files)
      },
      { once: true }
    )
    input.addEventListener(
      'cancel',
      () => {
        input.remove()
        resolve([])
      },
      { once: true }
    )
    document.body.append(input)
    input.click()
  })
}
function fileBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1])
    r.onerror = () => reject(new Error('文件读取失败'))
    r.readAsDataURL(file)
  })
}
async function uploadFiles() {
  const files = await chooseFile('.pdf,.docx,.md,.markdown,.txt', true),
    endpoint = base(),
    p = state.project
  if (!files.length) return
  let added = 0
  const failed = []
  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    toast(`正在导入 ${i + 1} / ${files.length}：${file.name}`)
    try {
      if (file.size > 30 * 1024 * 1024) throw new Error('文件超过30MB')
      await api(endpoint + '/import', 'POST', { name: file.name, base64: await fileBase64(file) })
      added++
    } catch (e) {
      failed.push(file.name + '：' + e.message)
    }
  }
  if (p === state.project) await afterChange(`已导入 ${added} 份资料`)
  if (failed.length) showError(new Error(failed.join('\n')))
}
async function loadChunks(id, target, offset = 0) {
  if (!id || !target) return
  target.replaceChildren(el('div', { class: 'busy-text' }, '正在读取分片…'))
  try {
    const data = await api(base() + '/documents/' + id + '/chunks?offset=' + offset)
    target.replaceChildren(
      el(
        'div',
        { class: 'section-row' },
        el('h3', {}, '已保存正文的分片'),
        muted(`共 ${data.total} 片`)
      ),
      el(
        'div',
        { class: 'chunk-list' },
        data.items.map((c, i) =>
          el(
            'article',
            { class: 'chunk' },
            el(
              'div',
              { class: 'chunk-head' },
              el('span', {}, `片段 ${offset + i + 1} · ${c.section || '未识别到章节'}`),
              el('span', {}, `${c.start}–${c.end} · ${c.text.length}字符`)
            ),
            el('pre', {}, c.text)
          )
        )
      ),
      el(
        'div',
        { class: 'pager' },
        button('上一页', () => loadChunks(id, target, Math.max(0, offset - data.limit)), 'small'),
        el(
          'span',
          {},
          `${Math.floor(offset / data.limit) + 1} / ${Math.max(1, Math.ceil(data.total / data.limit))}`
        ),
        button('下一页', () => loadChunks(id, target, offset + data.limit), 'small')
      )
    )
    const buttons = target.querySelectorAll('.pager button')
    buttons[0].disabled = offset === 0
    buttons[1].disabled = offset + data.limit >= data.total
  } catch (e) {
    target.replaceChildren(el('div', { class: 'error-box' }, e.message))
  }
}
async function loadStatus() {
  const id = state.project
  try {
    const status = await api(base() + '/status')
    if (id !== state.project) return
    state.status = status
    if (project()?.kind === 'shiping' && project().connected !== true) {
      project().connected = true
      renderSidebar()
    }
    $('status-badge')?.replaceChildren(statePill())
    updateStats()
    if (state.view === 'tasks') drawTask()
  } catch (e) {
    if (id !== state.project) return
    state.status = { state: 'error', message: e.message }
    if (e.status === 503 && project()?.kind === 'shiping' && project().connected !== false) {
      project().connected = false
      renderSidebar()
    }
    $('status-badge')?.replaceChildren(statePill())
    if (state.view === 'tasks') drawTask()
  }
}
async function rebuild() {
  const endpoint = base(),
    id = state.project
  if (state.status?.state === 'indexing') {
    toast('已有索引任务正在运行')
    return
  }
  await api(endpoint + '/rebuild', 'POST', {})
  if (id === state.project) await loadStatus()
  toast('索引任务已提交，可以继续浏览资料')
}
function drawTask() {
  if (!$('task-body')) return
  const s = state.status ?? {},
    symbols = { ready: '✓', indexing: '↻', error: '!', idle: '○' }
  $('task-body').replaceChildren(
    el(
      'div',
      { class: 'status-panel' },
      el('div', { class: 'status-circle ' + s.state }, symbols[s.state] ?? '○'),
      el(
        'div',
        { class: 'status-details' },
        el('h2', {}, s.message ?? '正在连接'),
        statePill(s),
        el(
          'div',
          { class: 'status-detail-row' },
          el('span', {}, `${number(s.documents)} 份资料`),
          el('span', {}, `${number(s.chunks)} 个片段`),
          el('span', {}, '状态自动刷新')
        )
      ),
      button(s.state === 'error' ? '重新尝试' : '建立 / 更新索引', rebuild, 'primary')
    )
  )
}
function renderSearch(content) {
  const query = el('textarea', {
      placeholder: '例如：爬爬老师课程网址是什么？',
      'aria-label': '检索问题'
    }),
    mode = el(
      'select',
      { 'aria-label': '检索场景' },
      el('option', { value: 'conversation' }, '对话场景'),
      el('option', { value: 'screenshot' }, '截图场景')
    ),
    results = el('div'),
    search = button(
      '检索知识库',
      async () => {
        const p = state.project
        search.disabled = true
        results.replaceChildren(el('div', { class: 'busy-text' }, '正在本机检索…'))
        try {
          const hits = await api(base() + '/search', 'POST', {
            query: query.value,
            mode: mode.value
          })
          if (p !== state.project) return
          results.replaceChildren(
            el(
              'div',
              { class: 'results-header' },
              el('span', {}, `找到 ${hits.length} 个相关片段`),
              el('span', {}, '仅检索，不调用云端回答模型')
            ),
            hits.length
              ? el(
                  'div',
                  {},
                  hits.map((hit, i) =>
                    el(
                      'article',
                      { class: 'result' },
                      el(
                        'div',
                        { class: 'result-meta' },
                        el('span', {}, String(i + 1).padStart(2, '0')),
                        el('span', { class: 'result-name' }, hit.name),
                        el('span', { class: 'score' }, '排序分 ' + Number(hit.score).toFixed(4))
                      ),
                      muted(hit.section ?? '未识别到章节'),
                      el('p', {}, hit.text),
                      el(
                        'div',
                        { class: 'section-row' },
                        muted(`原文位置 ${hit.start}–${hit.end}`),
                        button('查看原文', () => openEditor(hit.docId), 'small')
                      )
                    )
                  )
                )
              : empty('没有找到可用片段', '确认资料已参与当前场景，并完成索引。')
          )
        } catch (e) {
          results.replaceChildren(el('div', { class: 'error-box' }, e.message))
        } finally {
          search.disabled = false
        }
      },
      'primary'
    )
  query.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      search.click()
    }
  })
  content.append(
    el(
      'section',
      { class: 'panel search-box' },
      el('div', { class: 'query-row' }, query, search),
      el(
        'div',
        { class: 'search-tools' },
        el('label', {}, '使用场景 ', mode),
        el('span', {}, '⌘ / Ctrl + Enter 检索')
      )
    ),
    results
  )
}
function renderBackup(content) {
  const download = el('a', { href: base() + '/backup', class: 'primary' }, '下载 JSON 备份')
  content.append(
    el(
      'div',
      { class: 'two-columns' },
      el(
        'section',
        { class: 'action-card' },
        el('span', { class: 'card-icon' }, '↧'),
        el('h2', {}, '导出这份知识库'),
        el(
          'p',
          {},
          '包含正文、标签、场景、回收站资料，以及仍可取得的原始文件。备份保存在你选择的下载目录。'
        ),
        download
      ),
      el(
        'section',
        { class: 'action-card' },
        el('span', { class: 'card-icon' }, '↥'),
        el('h2', {}, '从备份追加恢复'),
        el('p', {}, '备份中的资料会作为新资料加入，现有内容不会被覆盖。恢复后会自动更新索引。'),
        button(
          '选择备份文件',
          async () => {
            const [file] = await chooseFile('.json')
            if (!file) return
            if (file.size > 45 * 1024 * 1024) throw new Error('备份超过45MB，请使用完整备份方式')
            let data
            try {
              data = JSON.parse(await file.text())
            } catch {
              throw new Error('这不是可读取的JSON备份文件')
            }
            if (data?.format !== 'local-rag-backup' || !Array.isArray(data.documents))
              throw new Error('这不是本地知识库备份')
            if (
              !(await ask(
                '追加恢复资料',
                `将新增 ${data.documents.length} 份资料，保留现有内容。`,
                { ok: '开始恢复' }
              ))
            )
              return
            const result = await api(base() + '/restore', 'POST', data)
            await afterChange(`已追加恢复 ${result.added} 份资料`)
          },
          'primary'
        )
      )
    ),
    el(
      'div',
      { class: 'hint' },
      'JSON备份用于资料恢复，不包含AI密钥或运行环境。大于45MB的整库备份，请先停止服务，再使用现有的完整备份功能。'
    )
  )
}
async function loadServices() {
  const seq = state.sequence
  const health = await api('/api/health')
  if (seq !== state.sequence || state.view !== 'services') return
  $('service-grid').replaceChildren(
    ...[
      ['向量数据库', health.chroma.ready, '资料分片与向量持久保存'],
      ['本地向量模型', health.ollama.ready && health.ollama.modelInstalled, 'BGE-M3 · 1024维'],
      ['Chrys资料连接', health.shiping.ready, '通过桌面程序同步资料修改']
    ].map(([name, ready, desc]) =>
      el(
        'section',
        { class: 'service' },
        el('h3', {}, name),
        el('span', { class: 'pill ' + (ready ? '' : 'error') }, ready ? '已连接' : '未连接'),
        el('p', {}, desc)
      )
    )
  )
  try {
    const collections = await api('/api/collections')
    if (seq !== state.sequence || state.view !== 'services') return
    $('collection-list').replaceChildren(
      collections.length
        ? el(
            'table',
            {},
            el(
              'thead',
              {},
              el(
                'tr',
                {},
                ['集合名称', '归属', '操作'].map((x) => el('th', {}, x))
              )
            ),
            el(
              'tbody',
              {},
              collections.map((c) =>
                el(
                  'tr',
                  {},
                  el('td', { class: 'collection-title' }, c.name),
                  el(
                    'td',
                    {},
                    el(
                      'span',
                      { class: 'tag' },
                      c.name.startsWith('shiping_')
                        ? 'Chrys'
                        : c.name.startsWith('rag_admin_')
                          ? '网页托管'
                          : '其他项目'
                    )
                  ),
                  el(
                    'td',
                    {},
                    button('浏览记录', () => loadRecords(c), 'small')
                  )
                )
              )
            )
          )
        : empty('向量库中还没有集合', '添加资料并建立索引后会显示在这里。')
    )
  } catch (e) {
    $('collection-list').replaceChildren(el('div', { class: 'empty' }, e.message))
  }
}
async function loadRecords(collection, offset = 0) {
  const target = $('collection-records')
  if (!target) return
  target.replaceChildren(el('div', { class: 'busy-text' }, '正在读取向量记录…'))
  const result = await api('/api/collections/' + collection.id + '/records?offset=' + offset)
  target.replaceChildren(
    el(
      'div',
      { class: 'section-row' },
      el('h2', {}, collection.name),
      muted(`共 ${result.total} 条 · 只读`)
    ),
    el(
      'div',
      { class: 'chunk-list' },
      result.items.map((row) =>
        el(
          'article',
          { class: 'chunk' },
          el('div', { class: 'chunk-head' }, row.id),
          el('pre', {}, row.text),
          el('pre', { class: 'collection-note' }, JSON.stringify(row.metadata, null, 2))
        )
      )
    ),
    el(
      'div',
      { class: 'pager' },
      button('上一页', () => loadRecords(collection, Math.max(0, offset - result.limit)), 'small'),
      el(
        'span',
        {},
        `${offset + 1}–${Math.min(result.total, offset + result.items.length)} / ${result.total}`
      ),
      button('下一页', () => loadRecords(collection, offset + result.limit), 'small')
    )
  )
  const buttons = target.querySelectorAll('.pager button')
  buttons[0].disabled = offset === 0
  buttons[1].disabled = offset + result.limit >= result.total
}
$('drawer-backdrop').addEventListener('click', async () => {
  if (await discard()) closeDrawer()
})
window.addEventListener('beforeunload', (e) => {
  if (state.dirty) {
    e.preventDefault()
    e.returnValue = ''
  }
})
document.addEventListener('keydown', async (e) => {
  if (e.key === 'Escape' && !$('drawer').hidden && !$('confirm-dialog').open && (await discard()))
    closeDrawer()
})
async function start() {
  const session = await api('/api/session')
  state.csrf = session.csrf
  await loadProjects()
  renderView()
  try {
    await refreshView()
  } catch (e) {
    showError(e)
  }
  setInterval(async () => {
    if (polling || document.hidden || state.view === 'services') return
    polling = true
    try {
      await loadStatus()
    } finally {
      polling = false
    }
  }, 3500)
}
start().catch((e) => {
  $('content').replaceChildren(
    empty(
      '暂时无法连接后台',
      e.message,
      button('刷新页面', () => location.reload())
    )
  )
  showError(e)
})
