let pyodide = null;
let running = false;
let waitingForInput = false;
let inputResolver = null;
let createMode = null;
let currentPath = '';
let savedSnapshot = '';

const $ = id => document.getElementById(id);

const editor = $('editor');
const terminal = $('terminal');
const terminalPanel = $('terminalPanel');
const terminalInput = $('terminalInput');
const sendInput = $('sendInput');
const runButton = $('run');
const argvInput = $('argv');
const filenameInput = $('filename');
const fileList = $('fileList');
const preview = $('preview');
const fileManager = $('fileManager');
const fileManagerToggle = $('fileManagerToggle');
const filesMenu = $('filesMenuPanel');
const tipBar = $('tipBar');
const unsavedLabel = $('unsavedLabel');

let files = {
    'main.py': {
        type: 'text',
        content: editor.value
    }
};

let currentFile = 'main.py';
const STORAGE_KEY = 'navterminal.files.v1';

let tips = [];
let recentTips = [];
let tipTimer = null;

function closeFilesMenu() {
    filesMenu.classList.add('hidden');
}

function write(t = '', c = 'output') {
    const e = document.createElement('div');
    e.className = c;
    e.textContent = t;
    terminal.appendChild(e);
    terminal.scrollTop = terminal.scrollHeight;
}

function toggleTerminal() {
    terminalPanel.classList.toggle('open');
    $('terminalToggle').setAttribute(
        'aria-expanded',
        terminalPanel.classList.contains('open')
    );
}

function clearTerminal() {
    terminal.replaceChildren();
}

function setInput(on, p = '›') {
    terminalInput.disabled = !on;
    sendInput.disabled = !on;

    if (on) {
        terminalInput.placeholder = p;
        terminalInput.focus();
    }
}

function submitInput() {
    if (!inputResolver) return;

    const v = terminalInput.value;
    terminalInput.value = '';

    const r = inputResolver;
    inputResolver = null;
    waitingForInput = false;

    setInput(false);
    write('› ' + v);
    r(v);
}

function browserInput(p = '') {
    terminalPanel.classList.add('open');
    waitingForInput = true;
    setInput(true, p);

    if (p) write(p);

    return new Promise(r => inputResolver = r);
}

function saveCurrent() {
    if (files[currentFile]?.type === 'text') {
        files[currentFile].content = editor.value;
    }
}

function normalize(p) {
    return p
        .split('/')
        .filter(x => x && x !== '.')
        .join('/');
}

function parentOf(p) {
    const a = p.split('/');
    a.pop();
    return a.join('/');
}

function nameOf(p) {
    return p.split('/').pop();
}

function renderFile(p) {
    const f = files[p];

    editor.classList.remove('hidden');
    preview.classList.add('hidden');

    if (!f) return;

    if (f.type === 'image') {
        editor.classList.add('hidden');
        preview.classList.remove('hidden');
        preview.replaceChildren();

        const i = document.createElement('img');
        i.src = f.content;
        i.alt = p;
        preview.append(i);
    } else if (f.type === 'text') {
        editor.value = f.content;
    } else {
        editor.classList.add('hidden');
        preview.classList.remove('hidden');
        preview.innerHTML = '<div class="preview-message">Compiled files cannot be rendered</div>';
    }
}

function savedData() {
    try {
        return JSON.parse(savedSnapshot || '{}');
    } catch (e) {
        return {};
    }
}

function isDirty(p) {
    const saved = savedData();
    return JSON.stringify(files[p]) !== JSON.stringify(saved[p]);
}

function renderList() {
    fileList.replaceChildren();

    const entries = [];

    if (currentPath) {
        entries.push({
            path: parentOf(currentPath),
            folder: true,
            up: true
        });
    }

    Object.keys(files)
        .filter(p => {
            const rest = currentPath
                ? p.slice(currentPath.length + 1)
                : p;

            if (currentPath && !p.startsWith(currentPath + '/')) {
                return false;
            }

            return rest && !rest.includes('/');
        })
        .forEach(p => {
            entries.push({
                path: p,
                folder: files[p].type === 'folder'
            });
        });

    entries
        .sort((a, b) => (
            a.up
                ? -1
                : b.up
                    ? 1
                    : a.folder === b.folder
                        ? nameOf(a.path).localeCompare(nameOf(b.path))
                        : a.folder
                            ? -1
                            : 1
        ))
        .forEach(x => {
            const row = document.createElement('div');
            row.className = 'file-row';

            const b = document.createElement('button');
            b.className = 'file-item'
                + (x.path === currentFile ? ' active' : '')
                + (x.folder ? ' folder-item' : '');

            b.textContent = x.up
                ? '[..]'
                : (isDirty(x.path) ? '* ' : '') + nameOf(x.path);

            b.title = x.up
                ? '[Parent folder - Go up one level]'
                : x.folder
                    ? `[${nameOf(x.path)} - Open folder]`
                    : `[${nameOf(x.path)} - Open file]`;

            b.onclick = () => {
                closeFilesMenu();

                if (x.folder) {
                    currentPath = x.up
                        ? parentOf(currentPath)
                        : x.path;
                    renderList();
                } else {
                    openFile(x.path);
                }
            };

            row.append(b);

            if (!x.up) {
                const d = document.createElement('button');
                d.className = 'file-delete';
                d.textContent = '✕';
                d.title = `[Delete - Remove ${nameOf(x.path)}]`;

                d.onclick = e => {
                    e.stopPropagation();
                    closeFilesMenu();
                    removeItem(x.path);
                };

                row.append(d);
            }

            fileList.append(row);
        });
}

function openFile(p) {
    saveCurrent();
    currentFile = p;
    filenameInput.value = p;
    renderFile(p);
    renderList();
    updateUnsavedIndicator();
}

function removeItem(p) {
    const targets = files[p]?.type === 'folder'
        ? Object.keys(files).filter(x => x === p || x.startsWith(p + '/'))
        : [p];

    targets.forEach(x => delete files[x]);

    if (currentFile && targets.includes(currentFile)) {
        const py = Object.keys(files).find(
            x => files[x].type === 'text' && /\.py$/i.test(x)
        );

        currentFile = py || 'main.py';

        if (!files[currentFile]) {
            files[currentFile] = {
                type: 'text',
                content: ''
            };
        }

        filenameInput.value = currentFile;
        renderFile(currentFile);
    }

    renderList();
    updateUnsavedIndicator();
}

function beginCreate(mode, root = false) {
    closeFilesMenu();
    createMode = { mode, root };

    let row = document.getElementById('createRow');

    if (!row) {
        row = document.createElement('div');
        row.id = 'createRow';
        row.className = 'create-row';
        row.innerHTML = `
            <input id="createName">
            <button id="createConfirm">✓</button>
            <button id="createCancel">✕</button>
        `;

        fileList.before(row);

        $('createConfirm').onclick = confirmCreate;
        $('createCancel').onclick = cancelCreate;

        $('createName').onkeydown = e => {
            if (e.key === 'Enter') confirmCreate();
            if (e.key === 'Escape') cancelCreate();
        };
    }

    row.classList.remove('hidden');
    $('createName').value = '';
    $('createName').placeholder = mode === 'file'
        ? 'filename.txt'
        : 'folder name';
    $('createName').focus();
}

function cancelCreate() {
    createMode = null;
    $('createRow')?.classList.add('hidden');
}

function confirmCreate() {
    const n = normalize($('createName').value.trim());

    if (!n || n.includes('..')) return;

    const base = createMode.root ? '' : currentPath;
    const p = normalize(base + '/' + n);

    if (files[p]) return;

    files[p] = createMode.mode === 'folder'
        ? { type: 'folder' }
        : { type: 'text', content: '' };

    const m = createMode.mode;

    cancelCreate();
    renderList();

    if (m === 'file') {
        openFile(p);
    }
}

async function addFile(file, path) {
    path = normalize(path || file.name);

    files[path] = isText(path, file.type)
        ? {
            type: 'text',
            content: await file.text()
        }
        : file.type.startsWith('image/')
            ? {
                type: 'image',
                content: await dataURL(file)
            }
            : {
                type: 'binary',
                content: await dataURL(file)
            };
}

function isText(n, t = '') {
    return t.startsWith('text/')
        || /\.(py|txt|md|json|csv|html|css|js|xml|yaml|yml|toml|ini|cfg|log)$/i.test(n);
}

function dataURL(b) {
    return new Promise((r, j) => {
        const f = new FileReader();
        f.onload = () => r(f.result);
        f.onerror = j;
        f.readAsDataURL(b);
    });
}

function dataBlob(u) {
    const [h, d] = u.split(',');
    const b = atob(d);
    const a = new Uint8Array(b.length);

    for (let i = 0; i < b.length; i++) {
        a[i] = b.charCodeAt(i);
    }

    return new Blob([a], {
        type: (h.match(/data:(.*?);/) || [])[1]
            || 'application/octet-stream'
    });
}

function snapshot() {
    saveCurrent();

    try {
        return JSON.stringify(files);
    } catch (e) {
        return '';
    }
}

function updateUnsavedIndicator() {
    saveCurrent();

    const saved = savedData();

    const dirtyFiles = Object.keys(files).filter(
        p => JSON.stringify(files[p]) !== JSON.stringify(saved[p])
    );

    const deletedFiles = Object.keys(saved).filter(
        p => !(p in files)
    );

    const dirty = dirtyFiles.length > 0 || deletedFiles.length > 0;

    unsavedLabel.classList.toggle('hidden', !dirty);
    renderList();
}

function markCleanIfSaved() {
    savedSnapshot = snapshot();
    updateUnsavedIndicator();
}

function persist() {
    closeFilesMenu();

    const typedName = filenameInput.value.trim();
    const oldPath = currentFile;
    const oldName = nameOf(oldPath);

    if (typedName && typedName !== oldName) {
        const parent = parentOf(oldPath);
        const newPath = normalize(
            parent ? parent + '/' + typedName : typedName
        );

        if (newPath !== oldPath && !files[newPath]) {
            saveCurrent();
            files[newPath] = files[oldPath];
            delete files[oldPath];
            currentFile = newPath;
            filenameInput.value = newPath;
        }
    }

    saveCurrent();

    try {
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify(files)
        );

        savedSnapshot = snapshot();
        updateUnsavedIndicator();
    } catch (e) {
        write('Save error: ' + e, 'error');
    }
}

function hasUnsavedChanges() {
    return snapshot() !== savedSnapshot;
}

function loadSaved() {
    try {
        const d = JSON.parse(
            localStorage.getItem(STORAGE_KEY) || 'null'
        );

        if (d && Object.keys(d).length) {
            files = d;

            const py = Object.keys(files).find(
                x => files[x].type === 'text' && /\.py$/i.test(x)
            );

            if (!py) {
                files['main.py'] = {
                    type: 'text',
                    content: ''
                };
            }

            currentFile = py || 'main.py';
            filenameInput.value = currentFile;
            renderFile(currentFile);
            markCleanIfSaved();

            return true;
        }
    } catch (e) {}

    return false;
}

function toggleFilesMenu() {
    filesMenu.classList.toggle('hidden');
}

async function downloadBlob(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();

    setTimeout(() => URL.revokeObjectURL(a.href), 500);
}

async function downloadCurrent() {
    closeFilesMenu();
    saveCurrent();

    const f = files[currentFile];

    if (!f || f.type === 'folder') return;

    await downloadBlob(
        f.type === 'text'
            ? new Blob([f.content], { type: 'text/plain' })
            : dataBlob(f.content),
        nameOf(currentFile)
    );
}

async function downloadTree(base) {
    closeFilesMenu();

    const zip = new JSZip();

    Object.entries(files).forEach(([p, f]) => {
        if (base && p !== base && !p.startsWith(base + '/')) return;
        if (f.type === 'folder') return;

        const rel = base
            ? p === base
                ? nameOf(p)
                : p.slice(base.length + 1)
            : p;

        zip.file(
            rel,
            f.type === 'text'
                ? f.content
                : dataBlob(f.content)
        );
    });

    await downloadBlob(
        await zip.generateAsync({ type: 'blob' }),
        (base ? nameOf(base) : 'workspace') + '.zip'
    );
}

async function uploadToRoot(list) {
    closeFilesMenu();

    for (const f of list) {
        await addFile(f, f.name);
    }

    renderList();
    persist();
}

async function uploadZipToRoot(file) {
    closeFilesMenu();

    const zip = await JSZip.loadAsync(file);

    for (const [path, obj] of Object.entries(zip.files)) {
        const clean = normalize(path);

        if (!clean) continue;

        if (obj.dir) {
            files[clean] = { type: 'folder' };
            continue;
        }

        const blob = await obj.async('blob');

        await addFile(
            new File(
                [blob],
                nameOf(clean),
                { type: blob.type }
            ),
            clean
        );
    }

    renderList();
    persist();
}

function closeNewProjectModal() {
    $('newProjectModal').classList.add('hidden');
}

function clearWorkspace() {
    files = {
        'main.py': {
            type: 'text',
            content: ''
        }
    };

    currentFile = 'main.py';
    currentPath = '';
    filenameInput.value = 'main.py';
    renderFile(currentFile);
    renderList();
    persist();
    closeNewProjectModal();
}

function openNewProjectModal() {
    closeFilesMenu();
    saveCurrent();
    $('newProjectModal').classList.remove('hidden');
    $('newProjectCancel').focus();
}

async function downloadAndClearProject() {
    await downloadTree('');
    clearWorkspace();
}

function toggleFileManager() {
    const c = fileManager.classList.toggle('collapsed');

    fileManagerToggle.textContent = c ? '▶' : '◀';
    fileManagerToggle.title = c
        ? '[Expand files - Show the workspace]'
        : '[Collapse files - Hide the workspace]';
}

function showTip() {
    if (!tips.length) return;

    let choices = tips.filter(
        (_, i) => !recentTips.includes(i)
    );

    if (!choices.length) {
        recentTips = [];
        choices = tips.slice();
    }

    const tip = choices[Math.floor(Math.random() * choices.length)];
    const index = tips.indexOf(tip);

    recentTips.push(index);

    if (recentTips.length > 10) {
        recentTips.shift();
    }

    tipBar.textContent = 'Tip - ' + tip;

    clearTimeout(tipTimer);
    tipTimer = setTimeout(showTip, 5000);
}

async function loadTips() {
    try {
        const r = await fetch(
            './pytip.txt?' + Date.now(),
            { cache: 'no-store' }
        );

        if (!r.ok) {
            throw new Error('HTTP ' + r.status);
        }

        tips = (await r.text())
            .split(/\r?\n/)
            .map(x => x.trim())
            .filter(Boolean);

        showTip();
    } catch (e) {
        tipBar.textContent = 'Tip - Unable to load tips';
    }
}

async function run() {
    if (!pyodide || running) return;

    saveCurrent();
    running = true;
    runButton.disabled = true;
    terminalPanel.classList.add('open');
    write('$ python ' + currentFile);

    try {
        for (const [p, f] of Object.entries(files)) {
            if (f.type === 'folder') continue;

            try {
                if (f.type === 'text') {
                    pyodide.FS.writeFile('/' + p, f.content);
                } else {
                    pyodide.FS.writeFile(
                        '/' + p,
                        Uint8Array.from(
                            atob(f.content.split(',')[1]),
                            c => c.charCodeAt(0)
                        )
                    );
                }
            } catch (e) {}
        }

        globalThis.consoleWrite = write;
        globalThis.browserInput = browserInput;

        await pyodide.runPythonAsync(`
import sys,js,io,builtins

class O(io.TextIOBase):
    def write(self,s):
        js.consoleWrite(str(s))
        return len(s)

    def flush(self):
        pass

sys.stdout=O()
sys.stderr=O()

def _nav_input(prompt=''):
    return __import__('pyodide.ffi',fromlist=['run_sync']).run_sync(js.browserInput(str(prompt)))

builtins.input=_nav_input
sys.argv=${JSON.stringify([
            currentFile,
            ...(argvInput.value.match(/\S+/g) || [])
        ])}

exec(
    compile(
        ${JSON.stringify(editor.value)},
        ${JSON.stringify(currentFile)},
        'exec'
    ),
    {'__name__':'__main__'}
)
`);
    } catch (e) {
        write(String(e), 'error');
    } finally {
        running = false;
        runButton.disabled = false;
    }
}

$('filesMenu').onclick = toggleFilesMenu;
$('fileManagerToggle').onclick = toggleFileManager;
$('save').onclick = persist;
$('workspaceSave').onclick = persist;
$('run').onclick = run;
$('clearTerminal').onclick = clearTerminal;
$('terminalToggle').onclick = toggleTerminal;
$('sendInput').onclick = submitInput;

$('terminalInput').onkeydown = e => {
    if (e.key === 'Enter') submitInput();
};

$('newFile').onclick = () => beginCreate('file');
$('newFolder').onclick = () => beginCreate('folder');
$('menuNewFile').onclick = () => beginCreate('file');
$('menuRootFile').onclick = () => beginCreate('file', true);
$('menuNewFolder').onclick = () => beginCreate('folder');
$('menuRootFolder').onclick = () => beginCreate('folder', true);

$('uploadFiles').onclick = () => $('uploadInput').click();
$('uploadRoot').onclick = () => $('uploadRootInput').click();
$('uploadFolder').onclick = () => $('folderInput').click();
$('uploadRootZip').onclick = () => $('zipInput').click();

$('downloadCurrent').onclick = downloadCurrent;
$('downloadHere').onclick = () => downloadTree(currentPath);
$('downloadRoot').onclick = () => downloadTree('');

$('newProject').onclick = openNewProjectModal;
$('newProjectCancel').onclick = closeNewProjectModal;
$('newProjectDelete').onclick = clearWorkspace;
$('newProjectZip').onclick = downloadAndClearProject;

$('uploadInput').onchange = async () => {
    closeFilesMenu();

    for (const f of $('uploadInput').files) {
        await addFile(
            f,
            currentPath
                ? currentPath + '/' + f.name
                : f.name
        );
    }

    renderList();
    persist();
};

$('uploadRootInput').onchange = async () => {
    await uploadToRoot($('uploadRootInput').files);
    $('uploadRootInput').value = '';
};

$('folderInput').onchange = async () => {
    closeFilesMenu();

    for (const f of $('folderInput').files) {
        await addFile(
            f,
            currentPath
                ? currentPath + '/' + f.webkitRelativePath
                : f.webkitRelativePath
        );
    }

    renderList();
    persist();
};

$('zipInput').onchange = async () => {
    if ($('zipInput').files[0]) {
        await uploadZipToRoot($('zipInput').files[0]);
    }

    $('zipInput').value = '';
};

$('tipBar').onclick = showTip;

editor.oninput = () => {
    saveCurrent();
    updateUnsavedIndicator();
};

document.addEventListener('click', e => {
    if (
        !filesMenu.classList.contains('hidden')
        && !filesMenu.contains(e.target)
        && e.target !== $('filesMenu')
    ) {
        closeFilesMenu();
    }
});

window.addEventListener('beforeunload', e => {
    if (hasUnsavedChanges()) {
        e.preventDefault();
        e.returnValue = '';
    }
});

(async () => {
    loadSaved() || renderFile('main.py');

    if (!Object.keys(files).some(
        x => files[x].type === 'text' && /\.py$/i.test(x)
    )) {
        files['main.py'] = {
            type: 'text',
            content: ''
        };

        currentFile = 'main.py';
        filenameInput.value = 'main.py';
        renderFile('main.py');
        persist();
    }

    renderList();

    if (matchMedia('(max-width:600px)').matches) {
        fileManager.classList.add('collapsed');
        fileManagerToggle.textContent = '▶';
    }

    if (!savedSnapshot) {
        markCleanIfSaved();
    }

    loadTips();

    try {
        pyodide = await loadPyodide();
        runButton.disabled = false;
    } catch (e) {
        write(String(e), 'error');
    }
})();
