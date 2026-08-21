let pyodide = null;
let running = false;
let waitingForInput = false;
let inputResolver = null;

const editor = document.getElementById('editor');
const terminal = document.getElementById('terminal');
const terminalPanel = document.getElementById('terminalPanel');
const terminalInput = document.getElementById('terminalInput');
const sendInput = document.getElementById('sendInput');
const inputPrompt = document.getElementById('inputPrompt');
const runButton = document.getElementById('run');
const clearTerminalButton = document.getElementById('clearTerminal');
const terminalToggle = document.getElementById('terminalToggle');
const argvInput = document.getElementById('argv');
const filenameInput = document.getElementById('filename');
const uploadInput = document.getElementById('upload');
const downloadButton = document.getElementById('download');

function write(text = '', className = 'output') {
  const line = document.createElement('div');
  line.className = className;
  line.textContent = text;
  terminal.appendChild(line);
  terminal.scrollTop = terminal.scrollHeight;
}

function openTerminal() {
  terminalPanel.classList.add('open');
  terminalToggle.setAttribute('aria-expanded', 'true');
}

function closeTerminal() {
  terminalPanel.classList.remove('open');
  terminalToggle.setAttribute('aria-expanded', 'false');
}

function toggleTerminal() {
  if (terminalPanel.classList.contains('open')) closeTerminal();
  else openTerminal();
}

function clearTerminal() {
  terminal.replaceChildren();
}

function setInputEnabled(enabled, promptText = '') {
  terminalInput.disabled = !enabled;
  sendInput.disabled = !enabled;
  if (enabled) {
    inputPrompt.textContent = promptText || '›';
    terminalInput.focus();
  } else {
    inputPrompt.textContent = '›';
  }
}

function submitInput() {
  if (!waitingForInput || !inputResolver) return;
  const value = terminalInput.value;
  terminalInput.value = '';
  write(`› ${value}`);
  const resolve = inputResolver;
  inputResolver = null;
  waitingForInput = false;
  setInputEnabled(false);
  resolve(value);
}

function browserInput(promptText) {
  openTerminal();
  waitingForInput = true;
  setInputEnabled(true, promptText);
  if (promptText) write(promptText, 'input-waiting');
  return new Promise(resolve => { inputResolver = resolve; });
}

function parseArgv(text) {
  const matches = text.match(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\S+/g) || [];
  return matches.map(arg => {
    if ((arg.startsWith('"') && arg.endsWith('"')) || (arg.startsWith("'") && arg.endsWith("'"))) {
      return arg.slice(1, -1);
    }
    return arg;
  });
}

function pythonFilename() {
  let name = filenameInput.value.trim() || 'main.py';
  if (!name.toLowerCase().endsWith('.py')) name += '.py';
  return name;
}

async function executePython(code, args) {
  globalThis.consoleWrite = write;
  globalThis.browserInput = browserInput;

  const bridge = `
import ast
import sys
import io
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
sys.argv = ${JSON.stringify(args)}

async def __nav_input(prompt=''):
    return await js.browserInput(str(prompt))

class InputAwaiter(ast.NodeTransformer):
    def visit_Call(self, node):
        node = self.generic_visit(node)
        if isinstance(node.func, ast.Name) and node.func.id == 'input':
            return ast.copy_location(ast.Await(value=ast.Call(
                func=ast.Name(id='__nav_input', ctx=ast.Load()),
                args=node.args,
                keywords=node.keywords
            )), node)
        return node

source = ${JSON.stringify(code)}
tree = ast.parse(source, filename=${JSON.stringify(pythonFilename())})
tree = InputAwaiter().visit(tree)
ast.fix_missing_locations(tree)

main_fn = ast.AsyncFunctionDef(
    name='__nav_main',
    args=ast.arguments(posonlyargs=[], args=[], kwonlyargs=[], kw_defaults=[], defaults=[]),
    body=tree.body,
    decorator_list=[]
)
module = ast.Module(body=[main_fn], type_ignores=[])
ast.fix_missing_locations(module)
namespace = {'__name__': '__main__', '__nav_input': __nav_input}
exec(compile(module, ${JSON.stringify(pythonFilename())}, 'exec'), namespace, namespace)
await namespace['__nav_main']()
`;

  await pyodide.runPythonAsync(bridge);
}

async function run() {
  if (!pyodide || running) return;
  running = true;
  runButton.disabled = true;
  openTerminal();
  write(`$ python ${pythonFilename()}${argvInput.value.trim() ? ` ${argvInput.value.trim()}` : ''}`);

  const args = [pythonFilename(), ...parseArgv(argvInput.value)];

  try {
    await executePython(editor.value, args);
  } catch (error) {
    write(String(error), 'error');
  } finally {
    running = false;
    waitingForInput = false;
    inputResolver = null;
    setInputEnabled(false);
    runButton.disabled = false;
  }
}

function downloadCode() {
  const blob = new Blob([editor.value], { type: 'text/x-python;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = pythonFilename();
  link.click();
  URL.revokeObjectURL(url);
}

uploadInput.addEventListener('change', async () => {
  const file = uploadInput.files?.[0];
  if (!file) return;
  editor.value = await file.text();
  filenameInput.value = file.name.toLowerCase().endsWith('.py') ? file.name : `${file.name}.py`;
  uploadInput.value = '';
});

downloadButton.addEventListener('click', downloadCode);
runButton.addEventListener('click', run);
clearTerminalButton.addEventListener('click', clearTerminal);
terminalToggle.addEventListener('click', toggleTerminal);
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
    runButton.disabled = false;
  } catch (error) {
    write(String(error), 'error');
  }
})();
