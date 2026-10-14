import {test} from 'node:test';import assert from 'node:assert/strict';
import {workspaceShortcuts,debugShortcuts} from '../src/components/student/shortcut-catalog.ts';
import {defaultEditorKeymap,shortcutError} from '../src/components/student/editor-keymap.ts';
test('close workspace shortcut is reserved from editor overrides',()=>{assert.ok(workspaceShortcuts.some(([label,key])=>label.includes('关闭答题页')&&key==='Alt + W'));assert.ok(shortcutError('Alt+w',defaultEditorKeymap,'comment'));});
test('debug catalog includes every requested control without replacing general actions',()=>{assert.equal(debugShortcuts.length,7);for(const name of ['Start Debugging','Stop Debugging','Skip Forward','Step over','Step in','Step out','Restart'])assert.ok(debugShortcuts.some(([label])=>label.includes(name)));assert.ok(!workspaceShortcuts.some(([label])=>label.includes('Debug')));});
