let pyodide = null;
let running = false;
let waitingForInput = false;
let inputResolver = null;

const editor = document.getElementById('editor');
const terminal = document.getElementById('terminal');
const terminalInput = document.getElementById('terminalInput');
const sendInput = document.getElementById('sendInput');
const runButton = document.getElementById('run');
const clearButton = document.getElementById('clear');
const status = document.getElementById('status');

function write(text = '', className = 'output') {
  const line = document.createElement('div');
  line.className = className;
  line.textContent = text;
  terminal.appendChild(line);
  terminal.scrollTop = terminal.scrollHeight;
}

function setInputEnabled(enabled) {
  terminalInput.disabled = !enabled;
  sendInput.disabled = !enabled;
  if (enabled) terminalInput.focus();
}

function submitInput() {
  if (!waitingForInput || !inputResolver) return;
  const value = terminalInput.value;
  terminalInput.value = '';
  write(value);
  const resolve = inputResolver;
  inputResolver = null;
  waitingForInput = false;
  setInputEnabled(false);
  resolve(value);
}

function browserInput(promptText) {
  if (promptText) write(promptText, 'input-waiting');
  waitingForInput = true;
  setInputEnabled(true);
  return new Promise(resolve => { inputResolver = resolve; });
}

async function executePython(code) {
  const bridge = `
import sys
import io
import builtins
import js

class BrowserStdout(io.TextIOBase):
    def write(self, s):
        if s:
            js.consoleWrite(str(s))
        return len(s)
    def flush(self):
        pass

sys.stdout = BrowserStdout()
sys.stderr = BrowserStdout()

async def _browser_input(prompt=''):
    return await js.browserInput(str(prompt))

async def _run_user_code():
    original_input = builtins.input
    builtins.input = lambda prompt='': js.browserInput(str(prompt))
    try:
        namespace = {'__name__': '__main__'}
        exec(compile(${JSON.stringify(code)}, '<main.py>', 'exec'), namespace, namespace)
    finally:
        builtins.input = original_input

await _run_user_code()
`;

  pyodide.globals.set('consoleWrite', write);
  pyodide.globals.set('browserInput', browserInput);
  await pyodide.runPythonAsync(bridge);
}

async function run() {
  if (!pyodide || running) return;
  running = true;
  runButton.disabled = true;
  write('$ python main.py');
  try {
    await executePython(editor.value);
  } catch (error) {
    write(String(error), 'error');
  } finally {
    running = false;
    waitingForInput = false;
    inputResolver = null;
    setInputEnabled(false);
    runButton.disabled = false;
    write('');
  }
}

runButton.addEventListener('click', run);
clearButton.addEventListener('click', () => terminal.replaceChildren());
sendInput.addEventListener('click', submitInput);
terminalInput.addEventListener('keydown', event => {
  if (event.key === 'Enter') submitInput();
});

editor.addEventListener('keydown', event => {
  if (event.key === 'Tab') {
    event.preventDefault();
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    editor.setRangeText('    ', start, end, 'end');
  }
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    run();
  }
});

(async () => {
  try {
    pyodide = await loadPyodide();
    status.textContent = `Python ${pyodide.runPython('import sys; sys.version.split()[0]')} pronto`;
    runButton.disabled = false;
  } catch (error) {
    status.textContent = 'Falha ao carregar Python';
    write(String(error), 'error');
  }
})();
