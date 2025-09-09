/*
 * Minimal "part" node with structural indent/outdent commands.
 */

import { Node as ProsemirrorNode, DOMOutputSpec, Schema } from 'prosemirror-model';
import { Extension, ExtensionContext } from '../../api/extension';
import { EditorState, Transaction } from 'prosemirror-state';
import { ProsemirrorCommand, EditorCommandId } from '../../api/command';
import { BaseKey } from '../../api/basekeys';
import { PandocOutput, PandocTokenType, PandocToken } from '../../api/pandoc';
import { pandocAttrSpec, pandocAttrParseDom, pandocAttrReadAST, pandocAttrToDomAttr } from '../../api/pandoc_attr';

function isPart(node: ProsemirrorNode, schema: Schema) {
  return node.type === (schema.nodes as any).part;
}

function partHeader(node: ProsemirrorNode): DOMOutputSpec {
  const title = (node.attrs.title as string) || 'Part';
  return ['div', { class: 'part-header' }, title];
}

function findPartDepth(state: EditorState, schema: Schema): number | null {
  const { $from } = state.selection;
  for (let d = $from.depth; d >= 1; d--) {
    if (isPart($from.node(d), schema)) return d;
  }
  return null;
}

function nodeStartInParent($from: any, depth: number) {
  const parent = $from.node(depth - 1);
  const parentStart = $from.start(depth - 1);
  const index = $from.index(depth - 1);
  let posCursor = parentStart;
  for (let i = 0; i < parent.childCount; i++) {
    const ch = parent.child(i);
    if (i === index) {
      return { parent, parentStart, index, nodeStart: posCursor };
    }
    posCursor += ch.nodeSize;
  }
  return { parent, parentStart, index, nodeStart: parentStart };
}

const extension = (_context: ExtensionContext): Extension => {
  return {
    nodes: [
      {
        name: 'part',
        spec: {
          attrs: {
            ...pandocAttrSpec,
            title: { default: 'Part' },
          },
          content: 'block+',
          group: 'block',
          defining: true,
          parseDOM: [
            {
              tag: 'div.part',
              getAttrs(dom: Node | string) {
                const el = dom as Element;
                return { ...pandocAttrParseDom(el, {}), title: el.getAttribute('data-title') || 'Part' };
              },
            },
          ],
          toDOM(node: ProsemirrorNode): DOMOutputSpec {
            const attrs = {
              ...pandocAttrToDomAttr({ ...node.attrs, classes: ['part'] }),
              'data-title': node.attrs.title || 'Part',
            } as { [k: string]: string };
            return ['div', attrs, partHeader(node), ['div', { class: 'part-content' }, 0]];
          },
        },
        pandoc: {
          readers: [
            {
              token: PandocTokenType.Div,
              match: (tok: PandocToken) => {
                try {
                  const attr = pandocAttrReadAST(tok, 0);
                  return Array.isArray(attr.classes) && attr.classes.includes('part');
                } catch { return false; }
              },
              block: 'part',
              getAttrs: (tok: PandocToken) => {
                const attr = pandocAttrReadAST(tok, 0);
                const title = (attr.keyvalue || []).find(([k]: [string, string]) => k === 'title')?.[1] || 'Part';
                return { ...attr, title };
              },
              getChildren: (tok: PandocToken) => tok.c[1],
            },
          ],
          writer: (output: PandocOutput, node: ProsemirrorNode) => {
            output.writeToken(PandocTokenType.Div, () => {
              const classes = ['part'].concat((node.attrs.classes || []).filter((c: string) => c !== 'part'));
              const kv: [string, string][] = [];
              if (node.attrs.title) kv.push(['title', node.attrs.title as string]);
              (output as any).writeAttr(node.attrs.id, classes, kv as unknown as [[string, string]]);
              output.writeArray(() => output.writeNodes(node));
            });
          },
        },
      },
    ],

    commands: (schema: Schema) => {
      const indent = new ProsemirrorCommand(
        EditorCommandId.ListItemSink,
        [],
        (state: EditorState, dispatch?: (tr: Transaction) => void) => {
          const depth = findPartDepth(state, schema);
          if (depth == null) return false;
          const { $from } = state.selection;
          const { parent, parentStart, index, nodeStart } = nodeStartInParent($from, depth);
          if (index <= 0) return false;
          let pos = parentStart;
          let prev: { node: ProsemirrorNode; start: number } | null = null;
          for (let i = 0; i < parent.childCount; i++) {
            const ch = parent.child(i);
            if (i === index - 1) { prev = { node: ch, start: pos }; break; }
            pos += ch.nodeSize;
          }
          if (!prev || !isPart(prev.node, schema)) return false;
          const current = parent.child(index);
          const currentEnd = nodeStart + current.nodeSize;
          const insertInsidePrev = prev.start + prev.node.nodeSize - 1;
          if (dispatch) {
            let tr = state.tr.delete(nodeStart, currentEnd);
            const mappedInsert = tr.mapping.map(insertInsidePrev);
            tr = tr.insert(mappedInsert, current);
            dispatch(tr.scrollIntoView());
          }
          return true;
        },
        undefined
      );

      const outdent = new ProsemirrorCommand(
        EditorCommandId.ListItemLift,
        [],
        (state: EditorState, dispatch?: (tr: Transaction) => void) => {
          const depth = findPartDepth(state, schema);
          if (depth == null) return false;
          const { $from } = state.selection;
          const parent = $from.node(depth - 1);
          if (!isPart(parent, schema)) return false;
          const { parentStart, index, nodeStart } = nodeStartInParent($from, depth);
          const current = parent.child(index);
          const currentEnd = nodeStart + current.nodeSize;
          const afterParent = parentStart + parent.nodeSize;
          if (dispatch) {
            let tr = state.tr.delete(nodeStart, currentEnd);
            const mappedAfterParent = tr.mapping.map(afterParent);
            tr = tr.insert(mappedAfterParent, current);
            dispatch(tr.scrollIntoView());
          }
          return true;
        },
        undefined
      );

      return [indent, outdent];
    },

    baseKeys: (_schema: Schema) => {
      return [
        {
          key: BaseKey.Tab,
          command: (state: EditorState, dispatch?: (tr: Transaction) => void) => {
            // Reuse command via EditorCommandId.ListItemSink (command palette/toolbar)
            return false; // keep simple; user can use toolbar for now
          },
        },
        {
          key: BaseKey.ShiftTab,
          command: (state: EditorState, dispatch?: (tr: Transaction) => void) => {
            return false;
          },
        },
      ];
    },
  };
};

export default extension;
/*
 * Minimal "part" block with sibling/child structural commands.
 */

import { Node as ProsemirrorNode, DOMOutputSpec, Schema } from 'prosemirror-model';
import { Extension, ExtensionContext } from '../../api/extension';
import { EditorState, Transaction } from 'prosemirror-state';
import { ProsemirrorCommand, EditorCommandId } from '../../api/command';
import { BaseKey } from '../../api/basekeys';
import { PandocOutput, PandocTokenType, PandocToken } from '../../api/pandoc';
import { pandocAttrSpec, pandocAttrParseDom, pandocAttrReadAST, pandocAttrToDomAttr } from '../../api/pandoc_attr';

function partHeader(node: ProsemirrorNode) {
  const title = (node.attrs.title as string) || 'Part';
  return ['div', { class: 'part-header' }, title] as DOMOutputSpec;
}

function asPart(node: ProsemirrorNode, schema: Schema) {
  return node.type === (schema.nodes as any).part;
}

function findCurrentPartDepth(state: EditorState, schema: Schema): number | null {
  const { $from } = state.selection;
  for (let d = $from.depth; d >= 1; d--) {
    if (asPart($from.node(d), schema)) return d;
  }
  return null;
}

function nodeStartInParent($from: any, depth: number) {
  const parent = $from.node(depth - 1);
  const parentStart = $from.start(depth - 1);
  const index = $from.index(depth - 1);
  let posCursor = parentStart;
  for (let i = 0; i < parent.childCount; i++) {
    const ch = parent.child(i);
    if (i === index) {
      return { parent, parentStart, index, nodeStart: posCursor };
    }
    posCursor += ch.nodeSize;
  }
  return { parent, parentStart, index, nodeStart: parentStart };
}

const extension = (_context: ExtensionContext): Extension => {
  return {
    nodes: [
      {
        name: 'part',
        spec: {
          attrs: {
            ...pandocAttrSpec,
            title: { default: 'Part' },
          },
          content: 'block+',
          group: 'block',
          defining: true,
          parseDOM: [
            {
              tag: 'div.part',
              getAttrs(dom: Node | string) {
                const el = dom as Element;
                return { ...pandocAttrParseDom(el, {}), title: el.getAttribute('data-title') || 'Part' };
              },
            },
          ],
          toDOM(node: ProsemirrorNode): DOMOutputSpec {
            const attrs = {
              ...pandocAttrToDomAttr({ ...node.attrs, classes: ['part'] }),
              'data-title': node.attrs.title || 'Part',
            } as { [k: string]: string };
            return ['div', attrs, partHeader(node), ['div', { class: 'part-content' }, 0]];
          },
        },
        pandoc: {
          readers: [
            {
              token: PandocTokenType.Div,
              match: (tok: PandocToken) => {
                try {
                  const attr = pandocAttrReadAST(tok, 0);
                  return Array.isArray(attr.classes) && attr.classes.includes('part');
                } catch { return false; }
              },
              block: 'part',
              getAttrs: (tok: PandocToken) => {
                const attr = pandocAttrReadAST(tok, 0);
                const title = (attr.keyvalue || []).find(([k]: [string, string]) => k === 'title')?.[1] || 'Part';
                return { ...attr, title };
              },
              getChildren: (tok: PandocToken) => tok.c[1],
            },
          ],
          writer: (output: PandocOutput, node: ProsemirrorNode) => {
            output.writeToken(PandocTokenType.Div, () => {
              // write as Div with class .part and title attr
              const classes = ['part'].concat((node.attrs.classes || []).filter((c: string) => c !== 'part'));
              const kv: [string, string][] = [];
              if (node.attrs.title) kv.push(['title', node.attrs.title as string]);
              (output as any).writeAttr(node.attrs.id, classes, kv as unknown as [[string, string]]);
              output.writeArray(() => output.writeNodes(node));
            });
          },
        },
      },
    ],

    commands: (schema: Schema) => {
      // Make current part a child of previous sibling (if present)
      const indent = new ProsemirrorCommand(
        EditorCommandId.ListItemSink,
        [],
        (state: EditorState, dispatch?: (tr: Transaction) => void) => {
          const depth = findCurrentPartDepth(state, schema);
          if (depth == null) return false;
          const { $from } = state.selection;
          const { parent, parentStart, index, nodeStart } = nodeStartInParent($from, depth);
          if (index <= 0) return false;
          // find previous sibling and its start
          let pos = parentStart;
          let prev: { node: ProsemirrorNode; start: number } | null = null;
          for (let i = 0; i < parent.childCount; i++) {
            const ch = parent.child(i);
            if (i === index - 1) { prev = { node: ch, start: pos }; break; }
            pos += ch.nodeSize;
          }
          if (!prev || !asPart(prev.node, schema)) return false;
          const current = parent.child(index);
          const currentEnd = nodeStart + current.nodeSize;
          const insertInsidePrev = prev.start + prev.node.nodeSize - 1;
          if (dispatch) {
            let tr = state.tr.delete(nodeStart, currentEnd);
            const mappedInsert = tr.mapping.map(insertInsidePrev);
            tr = tr.insert(mappedInsert, current);
            dispatch(tr.scrollIntoView());
          }
          return true;
        },
        undefined
      );

      // Make current part a sibling of its parent (if parent is a part)
      const outdent = new ProsemirrorCommand(
        EditorCommandId.ListItemLift,
        [],
        (state: EditorState, dispatch?: (tr: Transaction) => void) => {
          const depth = findCurrentPartDepth(state, schema);
          if (depth == null) return false;
          const { $from } = state.selection;
          const parent = $from.node(depth - 1);
          if (!asPart(parent, schema)) return false; // no parent part
          const { parentStart, index, nodeStart } = nodeStartInParent($from, depth);
          const current = parent.child(index);
          const currentEnd = nodeStart + current.nodeSize;
          const afterParent = parentStart + parent.nodeSize;
          if (dispatch) {
            let tr = state.tr.delete(nodeStart, currentEnd);
            const mappedAfterParent = tr.mapping.map(afterParent);
            tr = tr.insert(mappedAfterParent, current);
            dispatch(tr.scrollIntoView());
          }
          return true;
        },
        undefined
      );

      return [indent, outdent];
    },

    baseKeys: (schema: Schema) => {
      return [
        {
          key: BaseKey.Tab,
          command: (state: EditorState, dispatch?: (tr: Transaction) => void) => {
            // Reuse ListItemSink command implementation
            const cmds = [EditorCommandId.ListItemSink];
            return false;
          },
        },
        {
          key: BaseKey.ShiftTab,
          command: (state: EditorState, dispatch?: (tr: Transaction) => void) => {
            // Reuse ListItemLift command implementation
            return false;
          },
        },
      ];
    },
  };
};

export default extension;
/*
 * exam.ts
 */

import { Node as ProsemirrorNode, DOMOutputSpec, Schema, Fragment } from 'prosemirror-model';
import { Extension, ExtensionContext } from '../../api/extension';
import { PandocOutput, PandocTokenType, PandocToken } from '../../api/pandoc';
import { pandocAttrSpec, pandocAttrToDomAttr, pandocAttrParseDom, pandocAttrReadAST } from '../../api/pandoc_attr';
import { EditorState, Transaction } from 'prosemirror-state';
import { BaseKey } from '../../api/basekeys';
import { ProsemirrorCommand, EditorCommandId } from '../../api/command';

import './exam-styles.css';

// legacy constants removed with single-node model

function uniqueStrings(values: string[] | undefined | null): string[] {
  return Array.from(new Set((values || []).filter(Boolean)));
}

const ROLE_CLASSES = ['question', 'part', 'subpart', 'subsubpart'];

// setRoleClass no longer used with numeric-only roles; keep for potential future use

const extension = (_context: ExtensionContext): Extension => {
  return {
    nodes: [
      {
        name: 'exam_block',
        spec: {
          attrs: {
            ...pandocAttrSpec,
            title: { default: 'Question' },
            level: { default: 1 },
            debugId: { default: '' },
            parentDebugId: { default: '' },
          },
          content: 'block+',
          group: 'block list_item_block',
          isolating: true,
          defining: true,
          parseDOM: [
            {
              tag: 'div[class~="exam"]',
              getAttrs(dom: Node | string) {
                const el = dom as Element;
                const base = pandocAttrParseDom(el, {});
                const levelAttr = parseInt(el.getAttribute('data-level') || '1', 10) || 1;
                return {
                  ...base,
                  title: el.getAttribute('data-title') || 'Question',
                  level: Math.max(1, Math.min(4, levelAttr)),
                };
              },
            },
          ],
          toDOM(node: ProsemirrorNode): DOMOutputSpec {
            const level = Number(node.attrs.level) || 1;
            const classes = uniqueStrings([...(node.attrs.classes || []).filter((c: string) => c !== 'question' && c !== 'part' && c !== 'subpart' && c !== 'subsubpart'), 'exam']);
            const attrs = {
              ...pandocAttrToDomAttr({ ...node.attrs, classes }),
              'data-title': node.attrs.title,
              'data-level': String(level),
              'data-debug-id': (node.attrs as any).debugId || '',
              'data-parent-debug-id': (node.attrs as any).parentDebugId || '',
            } as { [key: string]: string };
            const label = level === 1 ? 'Question' : level === 2 ? 'Part' : level === 3 ? 'Subpart' : 'Subsubpart';
            const debugSuffix = (() => {
              const did = (node.attrs as any).debugId || '';
              const pdid = (node.attrs as any).parentDebugId || '';
              const parts: string[] = [];
              if (did) parts.push(did);
              parts.push('L' + String(level));
              if (pdid) parts.push('P' + pdid);
              return parts.length ? ` [${parts.join(' ')}]` : '';
            })();
            return [
              'div',
              attrs,
              ['div', { class: 'exam-header' }, (node.attrs.title || label) + debugSuffix],
              ['div', { class: 'exam-content' }, 0],
            ];
          },
        },
        pandoc: {
          readers: [
            {
              token: PandocTokenType.Div,
              match: (tok: PandocToken) => {
                try {
                  const attr = pandocAttrReadAST(tok, 0);
                  const classes = attr.classes || [];
                  return classes.includes('exam') || classes.includes('question') || classes.includes('part') || classes.includes('subpart') || classes.includes('subsubpart');
                } catch {
                  return false;
                }
              },
              block: 'exam_block',
              getAttrs: (tok: PandocToken) => {
                const attr = pandocAttrReadAST(tok, 0);
                const classes = uniqueStrings(attr.classes);
                const title = (attr.keyvalue || []).find(([k]) => k === 'title')?.[1] || 'Question';
                const explicitLevel = parseInt((attr.keyvalue || []).find(([k]) => k === 'level')?.[1] || '', 10);
                const levelFromClass = classes.includes('subsubpart') ? 4 : classes.includes('subpart') ? 3 : classes.includes('part') ? 2 : 1;
                const level = Number.isFinite(explicitLevel) && explicitLevel >= 1 ? explicitLevel : levelFromClass;
                return { ...attr, classes, title, level };
              },
              getChildren: (tok: PandocToken) => tok.c[1],
            },
          ],
          writer: (output: PandocOutput, node: ProsemirrorNode) => {
            output.writeToken(PandocTokenType.Div, () => {
              const level = Number(node.attrs.level) || 1;
              const role = level === 1 ? 'question' : level === 2 ? 'part' : level === 3 ? 'subpart' : 'subsubpart';
              const other = (node.attrs.classes || []).filter((c: string) => !ROLE_CLASSES.includes(c));
              const classes = uniqueStrings(['exam', role, ...other]);
              const keyvalue = (node.attrs.keyvalue || []) as [[string, string]] | undefined;
              const kv = (keyvalue ? [...keyvalue] : []) as [string, string][];
              const title = node.attrs.title as string | undefined;
              const setKV = (k: string, v: string) => {
                const idx = kv.findIndex(([key]) => key === k);
                if (idx >= 0) kv.splice(idx, 1);
                kv.push([k, v]);
              };
              if (title) setKV('title', title);
              setKV('level', String(level));
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (output as any).writeAttr(node.attrs.id, classes, kv as unknown as [[string, string]]);
              output.writeArray(() => {
                output.writeNodes(node);
              });
            });
          },
        },
      },
    ],

    commands: (schema: Schema) => {
      function clampLevel(level: number) { return Math.max(1, Math.min(4, level | 0)); }

      function bumpLevels(node: ProsemirrorNode, delta: number): ProsemirrorNode {
        const typeExam = (schema.nodes as any).exam_block;
        const children: ProsemirrorNode[] = [];
        node.content.forEach((child: ProsemirrorNode) => {
          if (child.type === typeExam) {
            const childLevel = clampLevel((child.attrs.level as number) + delta);
            children.push(bumpLevels(child.type.createChecked({ ...child.attrs, level: childLevel }, child.content, child.marks), 0));
          } else {
            children.push(child);
          }
        });
        if (node.type === typeExam) {
          const level = clampLevel((node.attrs.level as number) + delta);
          return node.type.createChecked({ ...node.attrs, level }, Fragment.from(children), node.marks);
        } else {
          return node.copy(Fragment.from(children));
        }
      }

      function findCurrentDepth(state: EditorState): { depth: number } | null {
        const { $from } = state.selection;
        for (let d = $from.depth; d >= 1; d--) {
          if ($from.node(d).type === (schema.nodes as any).exam_block) return { depth: d };
        }
        return null;
      }

      function nodeStartInParent($from: any, depth: number): { parent: ProsemirrorNode; parentStart: number; index: number; nodeStart: number } {
        const parent = $from.node(depth - 1);
        const parentStart = $from.start(depth - 1);
        const index = $from.index(depth - 1);
        let posCursor = parentStart;
        for (let i = 0; i < parent.childCount; i++) {
          const ch = parent.child(i);
          if (i === index) {
            return { parent, parentStart, index, nodeStart: posCursor };
          }
          posCursor += ch.nodeSize;
        }
        // fallback
        return { parent, parentStart, index, nodeStart: parentStart };
      }

      function commandIndent(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
        const typeExam = (schema.nodes as any).exam_block;
        const depthInfo = findCurrentDepth(state);
        if (!depthInfo) return false;
        const d = depthInfo.depth;
        const { $from } = state.selection;
        const { parent, parentStart, index, nodeStart } = nodeStartInParent($from, d);
        if (index <= 0) return false; // no previous sibling to indent under
        const prevInfo = (() => {
          let pos = parentStart;
          for (let i = 0; i < parent.childCount; i++) {
            const ch = parent.child(i);
            if (i === index - 1) {
              return { node: ch, start: pos };
            }
            pos += ch.nodeSize;
          }
          return null;
        })();
        if (!prevInfo) return false;
        if (prevInfo.node.type !== typeExam) return false; // only indent under exam sibling

        const current = parent.child(index);
        const currentEnd = nodeStart + current.nodeSize;
        const prevEndInside = prevInfo.start + prevInfo.node.nodeSize - 1; // position just before prev close

        // Build updated node with level+1 cascading
        const updated = bumpLevels(current, +1);

        if (dispatch) {
          let tr = state.tr;
          // delete current from parent
          tr = tr.delete(nodeStart, currentEnd);
          // map insertion pos (prev sibling before deletion, so unaffected)
          const insertPos = tr.mapping.map(prevEndInside);
          tr = tr.insert(insertPos, updated);
          dispatch(tr.scrollIntoView());
        }
        return true;
      }

      function commandOutdent(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
        const typeExam = (schema.nodes as any).exam_block;
        const depthInfo = findCurrentDepth(state);
        if (!depthInfo) return false;
        const d = depthInfo.depth;
        const { $from } = state.selection;
        const parent = $from.node(d - 1);
        if (parent.type !== typeExam) {
          // already at top-level exam or under non-exam; can't outdent structurally
          return false;
        }
        const { parentStart, index, nodeStart } = nodeStartInParent($from, d);
        const current = parent.child(index);
        const currentEnd = nodeStart + current.nodeSize;
        const parentEnd = parentStart + parent.nodeSize;
        const afterParent = parentEnd; // insert after parent
        // Don't allow going below level 1
        const currentLevel = clampLevel(current.attrs.level as number);
        if (currentLevel <= 1) return false;
        const updated = bumpLevels(current, -1);
        if (dispatch) {
          let tr = state.tr;
          tr = tr.delete(nodeStart, currentEnd);
          const mappedAfterParent = tr.mapping.map(afterParent);
          tr = tr.insert(mappedAfterParent, updated);
          dispatch(tr.scrollIntoView());
        }
        return true;
      }

      const indent = new ProsemirrorCommand(
        EditorCommandId.ExamIndent,
        [],
        (state: EditorState, dispatch?: (tr: Transaction) => void) => commandIndent(state, dispatch),
        undefined
      );

      const outdent = new ProsemirrorCommand(
        EditorCommandId.ExamOutdent,
        [],
        (state: EditorState, dispatch?: (tr: Transaction) => void) => commandOutdent(state, dispatch),
        undefined
      );

      const newPeer = new ProsemirrorCommand(
        EditorCommandId.ExamNewBlock,
        [],
        (state: EditorState, dispatch?: (tr: Transaction) => void) => {
          const { $from } = state.selection;
          for (let d = $from.depth; d >= 0; d--) {
            const node = $from.node(d);
            if ((schema.nodes as any).exam_block && node.type === (schema.nodes as any).exam_block) {
              if (!dispatch) return true;
              const level = Number(node.attrs.level) || 1;
              const insertPos = $from.after(d);
              const para = schema.nodes.paragraph?.createAndFill({}, undefined);
              const attrs = { ...node.attrs, level };
              const newBlock = (schema.nodes as any).exam_block.createAndFill(attrs, para ? [para] : undefined) as ProsemirrorNode;
              const tr = state.tr.insert(insertPos, newBlock).scrollIntoView();
              dispatch(tr);
              return true;
            }
          }
          return false;
        },
        undefined
      );

      return [indent, outdent, newPeer];
    },

    appendTransaction: () => {
      function to3Letter(n: number): string {
        n = Math.max(0, n);
        let s = '';
        for (let i = 0; i < 3; i++) {
          s = String.fromCharCode(97 + (n % 26)) + s;
          n = Math.floor(n / 26);
        }
        return s.toUpperCase();
      }

      return [{
        name: 'exam-debug-ids',
        append: (_tr, _transactions, _oldState, newState) => {
          const examType = (newState.schema.nodes as any).exam_block;
          if (!examType) return null;
          let tr = newState.tr;
          let changed = false;
          newState.doc.descendants((node, pos) => {
            if (node.type !== examType) return true;
            const $pos = newState.doc.resolve(pos + 1);
            let parentId = '';
            for (let d = $pos.depth - 1; d >= 0; d--) {
              const an = $pos.node(d);
              if (an.type === examType) {
                parentId = to3Letter($pos.before(d));
                break;
              }
            }
            const debugId = (node.attrs as any).debugId || to3Letter(pos);
            const parentDebugId = parentId;
            if ((node.attrs as any).debugId !== debugId || (node.attrs as any).parentDebugId !== parentDebugId) {
              const attrs = { ...node.attrs, debugId, parentDebugId } as any;
              tr = tr.setNodeMarkup(pos, node.type, attrs, node.marks);
              changed = true;
            }
            return true;
          });
          return changed ? tr : null;
        }
      }];
    },

    plugins: (_schema: Schema) => {
      return [];
    },

    baseKeys: (schema: Schema) => {
      return [
        {
          key: BaseKey.ModEnter,
          command: (state: EditorState, dispatch?: (tr: Transaction) => void) => {
            const { $from } = state.selection;
            for (let d = $from.depth; d >= 0; d--) {
              const node = $from.node(d);
              if ((schema.nodes as any).exam_block && node.type === (schema.nodes as any).exam_block) {
                if (!dispatch) return true;
                const level = Number(node.attrs.level) || 1;
                const insertPos = $from.after(d);
                const para = schema.nodes.paragraph?.createAndFill({}, undefined);
                const attrs = { ...node.attrs, level };
                const newBlock = (schema.nodes as any).exam_block.createAndFill(attrs, para ? [para] : undefined) as ProsemirrorNode;
                const tr = state.tr.insert(insertPos, newBlock);
                dispatch(tr.scrollIntoView());
                return true;
              }
            }
            return false;
          },
        },
      ];
    },
  };
};

export default extension;
