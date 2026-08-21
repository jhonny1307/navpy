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
  // Expose the callbacks on the actual JavaScript global object.
  // pyodide.globals.set() only creates Python globals, so js.consoleWrite
  // would otherwise raise AttributeError.
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
tree = ast.parse(source, filename='<main.py>')
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
exec(compile(module, '<main.py>', 'exec'), namespace, namespace)
await namespace['__nav_main']()
`;

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
