export const editorActions = ['comment','indent','outdent','moveUp','moveDown','undo','redo','format'] as const;
export type EditorAction = typeof editorActions[number];
export type EditorKeymap = Record<EditorAction,string>;
export const defaultEditorKeymap:EditorKeymap={comment:'Mod+/',indent:'Mod+]',outdent:'Mod+[',moveUp:'Alt+ArrowUp',moveDown:'Alt+ArrowDown',undo:'Mod+z',redo:'Mod+Shift+z',format:'Alt+Shift+f'};
export const editorActionLabels:Record<EditorAction,string>={comment:'行注释 / 取消注释',indent:'缩进一级',outdent:'取消缩进',moveUp:'向上移动代码行',moveDown:'向下移动代码行',undo:'撤销',redo:'重做',format:'代码格式化'};
type KeyEvent={key:string;code?:string;ctrlKey:boolean;metaKey:boolean;altKey:boolean;shiftKey:boolean};
export function eventBinding(e:KeyEvent){if(['Control','Meta','Alt','Shift','Dead','Process'].includes(e.key))return '';const punctuation:Record<string,string>={Slash:'/',BracketLeft:'[',BracketRight:']',Semicolon:';',Period:'.',Comma:',',Quote:"'",Backquote:'`',Equal:'=',Minus:'-'};const key=e.code&&punctuation[e.code]?punctuation[e.code]:e.code?.startsWith('Key')?e.code.slice(3).toLowerCase():e.key.length===1?e.key.toLowerCase():e.key;return [...(e.ctrlKey||e.metaKey?['Mod']:[]),...(e.altKey?['Alt']:[]),...(e.shiftKey?['Shift']:[]),key].join('+');}
export function shortcutError(binding:string,map:EditorKeymap,action:EditorAction){
 if(!/^(Mod\+)?(Alt\+)?(Shift\+)?(?:[a-z0-9/\[\];.,'`=\-]|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|F(?:[1-9]|1[0-2]))$/.test(binding)||(!binding.includes('Mod+')&&!binding.includes('Alt+')))return '请使用 Ctrl / ⌘ 或 Alt 加其他按键。';
 const key=binding.split('+').at(-1)!;
 if(binding.startsWith('Mod+')&&['s','w','t','r','l','n','q','p','c','v','x','a',"'",'Enter'].includes(key))return '该组合由页面或浏览器保留，请选择其他按键。';
 if(['Alt+w','Alt+f','Alt+Shift+p','Alt+Shift+m','Alt+ArrowLeft','Alt+ArrowRight','Alt+F4','Mod+Alt+ArrowLeft','Mod+Alt+ArrowRight'].includes(binding))return '该组合由页面或浏览器保留，请选择其他按键。';
 if(editorActions.some(a=>a!==action&&map[a]===binding))return '该组合已用于其他编辑器操作。';return '';
}
export function restoreEditorKeymap(value:unknown):EditorKeymap{const result={...defaultEditorKeymap};if(!value||typeof value!=='object')return result;const input=value as Partial<EditorKeymap>;const candidate={...result};for(const action of editorActions)if(typeof input[action]==='string')candidate[action]=input[action]!;return editorActions.every(action=>!shortcutError(candidate[action],candidate,action))?candidate:result;}
export function displayBinding(binding:string){return binding.replace('Mod','Ctrl / ⌘').replace('ArrowUp','↑').replace('ArrowDown','↓').replace('ArrowLeft','←').replace('ArrowRight','→').split('+').join(' + ');}
export function editorActionFor(e:KeyEvent,map:EditorKeymap){const b=eventBinding(e);return editorActions.find(a=>map[a]===b);}
