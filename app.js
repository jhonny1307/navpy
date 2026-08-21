let pyodide = null, running = false, waitingForInput = false, inputResolver = null;
const editor=document.getElementById('editor'), terminal=document.getElementById('terminal'), terminalPanel=document.getElementById('terminalPanel'), terminalInput=document.getElementById('terminalInput'), sendInput=document.getElementById('sendInput'), inputPrompt=document.getElementById('inputPrompt'), runButton=document.getElementById('run'), clearTerminalButton=document.getElementById('clearTerminal'), terminalToggle=document.getElementById('terminalToggle'), argvInput=document.getElementById('argv'), filenameInput=document.getElementById('filename'), uploadInput=document.getElementById('upload'), downloadButton=document.getElementById('download'), fileList=document.getElementById('fileList'), preview=document.getElementById('preview'), saveButton=document.getElementById('save');
let files={ 'main.py': {type:'text', content:editor.value} }, currentFile='main.py';
const STORAGE_KEY='navterminal.files.v1';

function write(text='', cls='output'){const line=document.createElement('div');line.className=cls;line.textContent=text;terminal.appendChild(line);terminal.scrollTop=terminal.scrollHeight;}
function openTerminal(){terminalPanel.classList.add('open');terminalToggle.setAttribute('aria-expanded','true')}
function closeTerminal(){terminalPanel.classList.remove('open');terminalToggle.setAttribute('aria-expanded','false')}
function toggleTerminal(){terminalPanel.classList.contains('open')?closeTerminal():openTerminal()}
function clearTerminal(){terminal.replaceChildren()}
function setInputEnabled(on,prompt=''){terminalInput.disabled=!on;sendInput.disabled=!on;if(on){inputPrompt.textContent=prompt||'›';terminalInput.focus()}else inputPrompt.textContent='›'}
function submitInput(){if(!waitingForInput||!inputResolver)return;const value=terminalInput.value;terminalInput.value='';write(`› ${value}`);const r=inputResolver;inputResolver=null;waitingForInput=false;setInputEnabled(false);r(value)}
function browserInput(prompt=''){openTerminal();waitingForInput=true;setInputEnabled(true,prompt);if(prompt)write(prompt,'input-waiting');return new Promise(r=>inputResolver=r)}
function parseArgv(text){return (text.match(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\S+/g)||[]).map(a=>(a[0]==='"'&&a.at(-1)==='"')||(a[0]==="'"&&a.at(-1)==="'")?a.slice(1,-1):a)}
function pythonFilename(){let n=filenameInput.value.trim()||'main.py';return n.toLowerCase().endsWith('.py')?n:n+'.py'}
function isText(name,type=''){return type.startsWith('text/')||/\.(py|txt|md|json|csv|html|css|js|xml|yaml|yml|toml|ini|cfg|log)$/i.test(name)}
function renderFile(name){const f=files[name];preview.classList.add('hidden');editor.classList.remove('hidden');if(!f)return;if(f.type==='image'){editor.classList.add('hidden');preview.classList.remove('hidden');preview.replaceChildren();const img=document.createElement('img');img.src=f.content;preview.appendChild(img)}else editor.value=f.content||''}
function saveCurrent(){if(!files[currentFile])files[currentFile]={type:'text',content:''};if(files[currentFile].type==='text')files[currentFile].content=editor.value;}
function renderFileList(){fileList.replaceChildren();Object.keys(files).sort((a,b)=>a.localeCompare(b)).forEach(name=>{const b=document.createElement('button');b.className='file-item'+(name===currentFile?' active':'');b.textContent=name;b.title=name;b.onclick=()=>openFile(name);fileList.appendChild(b)})}
function openFile(name){saveCurrent();currentFile=name;filenameInput.value=name;renderFile(name);renderFileList()}
function persist(){saveCurrent();const data={};for(const [name,f] of Object.entries(files))data[name]=f;localStorage.setItem(STORAGE_KEY,JSON.stringify(data));write('✓ Arquivos salvos localmente.','output')}
function loadSaved(){try{const data=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');if(data&&typeof data==='object'&&Object.keys(data).length){files=data;currentFile=Object.keys(files)[0];filenameInput.value=currentFile;renderFile(currentFile);return true}}catch(e){}return false}
async function addFile(file){if(isText(file.name,file.type)){files[file.name]={type:'text',content:await file.text()}}else if(file.type.startsWith('image/')){files[file.name]={type:'image',content:await blobToDataURL(file)}}else{files[file.name]={type:'binary',content:await blobToDataURL(file)}}}
function blobToDataURL(blob){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(blob)})}
async function executePython(code,args){globalThis.consoleWrite=write;globalThis.browserInput=browserInput;
  for(const [name,f] of Object.entries(files)){if(f.type==='text'){try{pyodide.FS.writeFile('/'+name,f.content)}catch(e){}}}
  const bridge=`
import ast,sys,io,js
class BrowserStdout(io.TextIOBase):
 def write(self,s):
  if s: js.consoleWrite(str(s))
  return len(s)
 def flush(self): pass
sys.stdout=BrowserStdout();sys.stderr=BrowserStdout();sys.argv=${JSON.stringify(args)}
async def __nav_input(prompt=''): return await js.browserInput(str(prompt))
class InputAwaiter(ast.NodeTransformer):
 def visit_Call(self,node):
  node=self.generic_visit(node)
  if isinstance(node.func,ast.Name) and node.func.id=='input': return ast.copy_location(ast.Await(value=ast.Call(func=ast.Name(id='__nav_input',ctx=ast.Load()),args=node.args,keywords=node.keywords)),node)
  return node
source=${JSON.stringify(code)};tree=ast.parse(source,filename=${JSON.stringify(pythonFilename())});tree=InputAwaiter().visit(tree);ast.fix_missing_locations(tree)
main_fn=ast.AsyncFunctionDef(name='__nav_main',args=ast.arguments(posonlyargs=[],args=[],kwonlyargs=[],kw_defaults=[],defaults=[]),body=tree.body,decorator_list=[]);module=ast.Module(body=[main_fn],type_ignores=[]);ast.fix_missing_locations(module)
namespace={'__name__':'__main__','__nav_input':__nav_input};exec(compile(module,${JSON.stringify(pythonFilename())},'exec'),namespace,namespace);await namespace['__nav_main']()
`;await pyodide.runPythonAsync(bridge)}
async function run(){if(!pyodide||running)return;saveCurrent();running=true;runButton.disabled=true;openTerminal();write(`$ python ${pythonFilename()}${argvInput.value.trim()?` ${argvInput.value.trim()}`:''}`);try{await executePython(editor.value,[pythonFilename(),...parseArgv(argvInput.value)])}catch(e){write(String(e),'error')}finally{running=false;waitingForInput=false;inputResolver=null;setInputEnabled(false);runButton.disabled=false}}
function downloadCode(){saveCurrent();const f=files[currentFile];const blob=f.type==='text'?new Blob([f.content],{type:'text/plain;charset=utf-8'}):dataURLToBlob(f.content);const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=currentFile;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500)}
function dataURLToBlob(url){const [head,data]=url.split(',');const bin=atob(data);const bytes=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);return new Blob([bytes],{type:(head.match(/data:(.*?);/)||[])[1]||'application/octet-stream'})}

uploadInput.addEventListener('change',async()=>{for(const file of [...uploadInput.files])await addFile(file);renderFileList();openFile([...uploadInput.files][0]?.name||currentFile);uploadInput.value=''});
downloadButton.addEventListener('click',downloadCode);saveButton.addEventListener('click',persist);runButton.addEventListener('click',run);clearTerminalButton.addEventListener('click',clearTerminal);terminalToggle.addEventListener('click',toggleTerminal);sendInput.addEventListener('click',submitInput);terminalInput.addEventListener('keydown',e=>{if(e.key==='Enter')submitInput()});
filenameInput.addEventListener('change',()=>{saveCurrent();const n=filenameInput.value.trim()||'main.py';if(n!==currentFile){files[n]=files[currentFile];delete files[currentFile];currentFile=n;renderFileList()}});
editor.addEventListener('input',saveCurrent);editor.addEventListener('keydown',e=>{if(e.key==='Tab'){e.preventDefault();const s=editor.selectionStart,t=editor.selectionEnd;editor.setRangeText('    ',s,t,'end')}if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();run()}});
(async()=>{loadSaved()||renderFile('main.py');renderFileList();try{pyodide=await loadPyodide();runButton.disabled=false}catch(e){write(String(e),'error')}})();
