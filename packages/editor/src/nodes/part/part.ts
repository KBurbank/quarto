/*
 * Minimal Part node with structural indent/outdent commands
 */

import { Node as ProsemirrorNode, DOMOutputSpec, Schema } from 'prosemirror-model';
import { Extension, ExtensionContext } from '../../api/extension';
import { EditorState, Transaction, Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import { DecorationSet, Decoration, EditorView, NodeView } from 'prosemirror-view';
import { gapCursor } from 'prosemirror-gapcursor';
import './part-styles.css';
import { ProsemirrorCommand } from '../../api/command';

import { OmniInsertGroup } from '../../api/omni_insert';
import { BaseKey } from '../../api/basekeys';
import { PandocOutput, PandocToken, PandocTokenType } from '../../api/pandoc';
import { pandocAttrReadAST, pandocAttrSpec, pandocAttrToDomAttr, pandocAttrParseDom } from '../../api/pandoc_attr';


function isPart(node: ProsemirrorNode, schema: Schema) {
  return node.type === (schema.nodes as any).part;
}

function titleFromAttrs(attrs: any): string {
  const direct = (attrs?.title as string) || '';
  if (direct && direct.length) return direct;
  const kv = (attrs?.keyvalue || []) as Array<[string, string]>;
  const found = kv.find(([k]) => k === 'title');
  return found ? found[1] : '';
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
            title: { default: '' },
            points: { default: '' },
          },
          content: 'block*',
          group: 'block',
          isolating: true,
          defining: true,
          allowGapCursor: true,
          parseDOM: [
            {
              tag: 'div.part',
              getAttrs(dom: Node | string) {
                const el = dom as Element;
                const base = pandocAttrParseDom(el, { class: 'part' }, true);
                return { ...base, title: el.getAttribute('data-title') || '' };
              },
            },
          ],
          toDOM(node: ProsemirrorNode): DOMOutputSpec {
            const domAttr = pandocAttrToDomAttr({
              ...node.attrs, classes: [
                ...(((node.attrs as any).classes || []) as string[]).filter((c: string) => c !== 'part'),
                'part',
              ]
            });
            const headerTitle = ((node.attrs as any).title as string) || titleFromAttrs(node.attrs) || '';
            const headerPoints = ((node.attrs as any).points as string) || '';
            (domAttr as any)['data-title'] = headerTitle;
            return ['div', domAttr as any,
              ['div', { class: 'part-header' },
                ['span', { class: 'part-label' }],
                ['span', { class: 'part-title' }, headerTitle],
                ['span', { class: 'part-points' }, headerPoints]
              ],
              ['div', { class: 'part_content' }, 0]
            ];
          },
          // use default createAndFill
        },

        // native attribute editor hook (kebab button on the right)
        attr_edit: () => ({
          type: (schema: Schema) => (schema.nodes as any).part,
          // no extra tag chips; only show the three-dots button
          tags: () => [],
          offset: { top: 3, right: 0 },
        }),
        pandoc: {
          readers: [
            {
              token: PandocTokenType.Div,
              match: (tok: PandocToken) => {
                try {
                  const attr = pandocAttrReadAST(tok, 0);
                  return Array.isArray(attr.classes) && attr.classes.includes('part');
                } catch {
                  return false;
                }
              },
              block: 'part',
              getAttrs: (tok: PandocToken) => {
                const attr = pandocAttrReadAST(tok, 0);
                const title = (attr.keyvalue || []).find(([k]: [string, string]) => k === 'title')?.[1] || '';
                const points = (attr.keyvalue || []).find(([k]: [string, string]) => k === 'points')?.[1] || '';
                return { ...attr, title, points } as { [key: string]: unknown };
              },
              getChildren: (tok: PandocToken) => (tok.c[1] as PandocToken[]),
            },
          ],
          writer: (output: PandocOutput, node) => {
            // write as a proper Pandoc Div with class 'part' so top-level JSON blocks are valid
            output.writeToken(PandocTokenType.Div, () => {
              const existingClasses = ((node.attrs as any).classes || []) as string[];
              const classes = ['part', ...existingClasses.filter(c => c !== 'part')];
              // Use attrs for title and points
              const title = (node.attrs as any).title || '';
              const points = (node.attrs as any).points || '';
              // merge keyvalue with title and points
              const existingKv = (((node.attrs as any).keyvalue || []) as Array<[string, string]>).filter(([k]) => k !== 'title' && k !== 'points');
              const keyvalue: Array<[string, string]> = [];
              if (title) keyvalue.push(['title', title]);
              if (points) keyvalue.push(['points', points]);
              keyvalue.push(...existingKv);

              output.writeAttr((node.attrs as any).id, classes, keyvalue as unknown as [[string, string]]);
              output.writeArray(() => {
                // Write all children as content
                output.writeNodes(node);
              });
            });
          },
        },
      },
    ],

    commands: (schema: Schema) => {
      const insertPart = new ProsemirrorCommand(
        'PartInsert' as any,
        [],
        (state: EditorState, dispatch?: (tr: Transaction) => void) => {
          const typePart = (schema.nodes as any).part;
          const paraType = (schema.nodes as any).paragraph;
          if (!dispatch || !typePart) return !!typePart;

          // Create optional initial paragraph content
          const contentPara = paraType?.createAndFill();
          const children = contentPara ? [contentPara] : undefined;

          const part = typePart.createAndFill({ title: '', points: '' }, children as any);
          if (!part) {
            console.error('Failed to create part node');
            return false;
          }

          const insertPos = state.selection.from;
          let tr = state.tr.replaceSelectionWith(part, false);
          // place cursor just inside the new node (at its start + 1)
          tr = tr.setSelection(TextSelection.create(tr.doc, insertPos + 1)).scrollIntoView();
          dispatch(tr);
          return true;
        },
        {
          name: 'Part',
          description: 'Insert a Part block (can contain nested Parts)',
          group: OmniInsertGroup.Blocks,
          image: () => '',
        }
      );

      const indent = new ProsemirrorCommand(
        'PartIndent' as any,
        [],
        (state: EditorState, dispatch?: (tr: Transaction) => void) => {
          const depth = findPartDepth(state, schema);
          if (depth == null) return false;
          const { $from } = state.selection;
          const { parent, parentStart, index, nodeStart } = nodeStartInParent($from, depth);
          if (index <= 0) return false;
          // scan left to nearest previous Part sibling (skip non-Part nodes)
          let pos = parentStart;
          let nearest: { node: ProsemirrorNode; start: number } | null = null;
          for (let i = 0; i < index; i++) {
            const ch = parent.child(i);
            if (isPart(ch, schema)) {
              nearest = { node: ch, start: pos };
            }
            pos += ch.nodeSize;
          }
          if (!nearest) return false;
          const current = parent.child(index);
          const currentEnd = nodeStart + current.nodeSize;
          const insertInsidePrev = nearest.start + nearest.node.nodeSize - 1;
          if (dispatch) {
            // preserve caret relative to the moved node's content
            const relAnchor = state.selection.anchor - (nodeStart + 1);
            const relHead = state.selection.head - (nodeStart + 1);
            let tr = state.tr.delete(nodeStart, currentEnd);
            const mappedInsert = tr.mapping.map(insertInsidePrev);
            tr = tr.insert(mappedInsert, current);
            const base = mappedInsert + 1;
            const newAnchor = Math.max(base, base + relAnchor);
            const newHead = Math.max(base, base + relHead);
            tr = tr.setSelection(TextSelection.create(tr.doc, newAnchor, newHead)).scrollIntoView();
            dispatch(tr);
          }
          return true;
        },
        undefined
      );

      const outdent = new ProsemirrorCommand(
        'PartOutdent' as any,
        [],
        (state: EditorState, dispatch?: (tr: Transaction) => void) => {
          const depth = findPartDepth(state, schema);
          if (depth == null) return false;
          const { $from } = state.selection;
          const parent = $from.node(depth - 1);
          if (!isPart(parent, schema)) return false;
          const { parentStart: _ps, index, nodeStart } = nodeStartInParent($from, depth);
          const current = parent.child(index);
          const currentEnd = nodeStart + current.nodeSize;
          const parentPosBefore = $from.before(depth - 1);
          const afterParent = parentPosBefore + parent.nodeSize;
          if (dispatch) {
            // preserve caret relative to the moved node's content
            const relAnchor = state.selection.anchor - (nodeStart + 1);
            const relHead = state.selection.head - (nodeStart + 1);
            let tr = state.tr.delete(nodeStart, currentEnd);
            const mappedAfterParent = tr.mapping.map(afterParent);
            tr = tr.insert(mappedAfterParent, current);
            const base = mappedAfterParent + 1;
            const newAnchor = Math.max(base, base + relAnchor);
            const newHead = Math.max(base, base + relHead);
            tr = tr.setSelection(TextSelection.create(tr.doc, newAnchor, newHead)).scrollIntoView();
            dispatch(tr);
          }
          return true;
        },
        undefined
      );

      return [insertPart, indent, outdent];
    },

    baseKeys: (schema: Schema) => {
      return [
        {
          key: BaseKey.Tab,
          command: (state: EditorState, dispatch?: (tr: Transaction) => void) => {
            const depth = findPartDepth(state, schema);
            if (depth == null) return false;
            const { $from } = state.selection;
            const { parent, parentStart, index, nodeStart } = nodeStartInParent($from, depth);
            if (index <= 0) return false;
            // find nearest previous Part sibling (skip non-Part nodes)
            let pos = parentStart;
            let nearest: { node: ProsemirrorNode; start: number } | null = null;
            for (let i = 0; i < index; i++) {
              const ch = parent.child(i);
              if (isPart(ch, schema)) nearest = { node: ch, start: pos };
              pos += ch.nodeSize;
            }
            if (!nearest) return false;
            const current = parent.child(index);
            const currentEnd = nodeStart + current.nodeSize;
            const insertInsidePrev = nearest.start + nearest.node.nodeSize - 1;
            if (dispatch) {
              // preserve caret relative to content
              const relAnchor = state.selection.anchor - (nodeStart + 1);
              const relHead = state.selection.head - (nodeStart + 1);
              let tr = state.tr.delete(nodeStart, currentEnd);
              const mappedInsert = tr.mapping.map(insertInsidePrev);
              tr = tr.insert(mappedInsert, current);
              const base = mappedInsert + 1;
              const newAnchor = Math.max(base, base + relAnchor);
              const newHead = Math.max(base, base + relHead);
              tr = tr.setSelection(TextSelection.create(tr.doc, newAnchor, newHead)).scrollIntoView();
              dispatch(tr);
            }
            return true;
          },
        },
        {
          key: BaseKey.ShiftTab,
          command: (state: EditorState, dispatch?: (tr: Transaction) => void) => {
            const depth = findPartDepth(state, schema);
            if (depth == null) return false;
            const { $from } = state.selection;
            const parent = $from.node(depth - 1);
            if (!isPart(parent, schema)) return false;
            const { index, nodeStart } = nodeStartInParent($from, depth);
            const current = parent.child(index);
            const currentEnd = nodeStart + current.nodeSize;
            const parentPosBefore = $from.before(depth - 1);
            const afterParent = parentPosBefore + parent.nodeSize;
            if (dispatch) {
              // preserve caret relative to content
              const relAnchor = state.selection.anchor - (nodeStart + 1);
              const relHead = state.selection.head - (nodeStart + 1);
              let tr = state.tr.delete(nodeStart, currentEnd);
              const mappedAfterParent = tr.mapping.map(afterParent);
              tr = tr.insert(mappedAfterParent, current);
              const base = mappedAfterParent + 1;
              const newAnchor = Math.max(base, base + relAnchor);
              const newHead = Math.max(base, base + relHead);
              tr = tr.setSelection(TextSelection.create(tr.doc, newAnchor, newHead)).scrollIntoView();
              dispatch(tr);
            }
            return true;
          },
        },
      ];
    },

    plugins: (schema: Schema) => {
      class PartNodeView implements NodeView {
        public dom: HTMLElement;
        public contentDOM: HTMLElement;
        private readonly view: EditorView;
        private readonly getPos: () => number;
        private titleInput: HTMLInputElement;
        private pointsInput: HTMLInputElement;
        private updating = false;

        constructor(node: ProsemirrorNode, view: EditorView, getPos: boolean | (() => number)) {
          this.view = view;
          this.getPos = getPos as () => number;

          // Outer container
          const dom = document.createElement('div');
          dom.classList.add('part');

          // Header
          const header = document.createElement('div');
          header.classList.add('part-header');

          const label = document.createElement('span');
          label.classList.add('part-label');
          header.appendChild(label);

          const titleInput = document.createElement('input');
          titleInput.classList.add('part-title');
          titleInput.type = 'text';
          titleInput.value = String((node.attrs as any).title || '');
          titleInput.placeholder = 'Title';
          header.appendChild(titleInput);

          const pointsInput = document.createElement('input');
          pointsInput.classList.add('part-points');
          pointsInput.type = 'text';
          pointsInput.value = String((node.attrs as any).points || '');
          pointsInput.placeholder = 'Points';
          header.appendChild(pointsInput);

          // Content container
          const content = document.createElement('div');
          content.classList.add('part_content');

          dom.appendChild(header);
          dom.appendChild(content);

          // Wire events
          const commit = () => {
            if (this.updating) return;
            const pos = this.getPos();
            if (typeof pos !== 'number') return;
            const nodeNow = this.view.state.doc.nodeAt(pos);
            if (!nodeNow) return;
            const currentTitle = String(((nodeNow.attrs as any).title || ''));
            const currentPoints = String(((nodeNow.attrs as any).points || ''));
            const nextTitle = titleInput.value;
            const nextPoints = pointsInput.value;
            if (currentTitle === nextTitle && currentPoints === nextPoints) return;
            const attrs = { ...(nodeNow.attrs as any), title: nextTitle, points: nextPoints } as any;
            const tr = this.view.state.tr.setNodeMarkup(pos, nodeNow.type, attrs);
            this.view.dispatch(tr);
          };

          titleInput.addEventListener('input', commit);
          pointsInput.addEventListener('input', commit);

          this.dom = dom;
          this.contentDOM = content;
          this.titleInput = titleInput;
          this.pointsInput = pointsInput;
        }

        update(node: ProsemirrorNode) {
          if ((node.type as any).name !== 'part') return false;
          this.updating = true;
          try {
            const title = String(((node.attrs as any).title || ''));
            const points = String(((node.attrs as any).points || ''));
            if (this.titleInput.value !== title) this.titleInput.value = title;
            if (this.pointsInput.value !== points) this.pointsInput.value = points;
          } finally {
            this.updating = false;
          }
          return true;
        }

        ignoreMutation(mutation: MutationRecord | { type: 'selection'; target: Element }) {
          // Ignore header input mutations
          const target = (mutation as MutationRecord).target as Node | undefined;
          if (target instanceof Element) {
            if (target === this.titleInput || target === this.pointsInput || target.closest('.part-header')) return true;
          }
          return false;
        }

        stopEvent(event: Event) {
          const target = event.target as HTMLElement | null;
          if (!target) return false;
          // Let inputs handle their own events
          if (target === this.titleInput || target === this.pointsInput || target.closest && target.closest('.part-header')) {
            return true;
          }
          return false;
        }
      }
      const key = new PluginKey<DecorationSet>('part-structure-level');

      function buildDecorations(state: EditorState): DecorationSet {
        const decorations: Decoration[] = [];
        const partType = (schema.nodes as any).part;
        const doc = state.doc;
        doc.descendants((node, pos) => {
          if (node.type === partType) {
            const $pos = doc.resolve(pos + 1);
            let level = 1;
            for (let d = $pos.depth - 1; d >= 0; d--) {
              if ($pos.node(d).type === partType) {
                level++;
              }
            }
            decorations.push(Decoration.node(pos, pos + node.nodeSize, { 'data-struct-level': String(level) }));
          }
          return true;
        });
        return DecorationSet.create(doc, decorations);
      }

      return [
        gapCursor(),
        new Plugin({
          props: {
            nodeViews: {
              part(node: ProsemirrorNode, view: EditorView, getPos: boolean | (() => number)) {
                return new PartNodeView(node, view, getPos);
              },
            },
          },
        }),
        // Auto-insert a paragraph when clicking at a gap position inside a Part
        new Plugin({
          props: {
            handleClick(view, pos, _event) {
              const state = view.state;
              const $pos = state.doc.resolve(pos);
              const partType = (schema.nodes as any).part;
              const paraType = (schema.nodes as any).paragraph;
              if (!paraType) return false;
              // only when clicking inside a Part container (between children)
              if ($pos.parent && $pos.parent.type === partType) {
                const index = $pos.index();
                const parent = $pos.parent;
                const prev = index > 0 ? parent.child(index - 1) : null;
                const next = index < parent.childCount ? parent.child(index) : null;
                // Avoid inserting if there's already a paragraph adjacent (prevents double-blank lines)
                if ((prev && prev.type === paraType) || (next && next.type === paraType)) {
                  return false;
                }
                if (parent.canReplaceWith(index, index, paraType)) {
                  const para = paraType.createAndFill();
                  if (!para) return false;
                  const tr = state.tr.insert(pos, para).setSelection(TextSelection.create(state.tr.doc, pos + 1)).scrollIntoView();
                  view.dispatch(tr);
                  return true;
                }
              }
              return false;
            },
          },
        }),
        // Dedicated attribute editor for Part title via three-dots decoration only

        new Plugin<DecorationSet>({
          key,
          state: {
            init: (_config, state) => buildDecorations(state),
            apply: (tr, value, _oldState, newState) => {
              if (!tr.docChanged) return value;
              return buildDecorations(newState);
            },
          },
          props: {
            decorations: (state: EditorState) => key.getState(state),
          },
        }),

        // Sync keyvalue['title'] -> attrs.title to keep attrs.title the single source of truth
        // DISABLED: Sync plugins disabled for now
        /*
        new Plugin({
          key: new PluginKey('part_title-sync'),
          appendTransaction: (_trs, _old, newState) => {
            const partType = (schema.nodes as any).part;
            let tr: Transaction | null = null;
            newState.doc.descendants((node, pos) => {
              if (node.type === partType) {
                const kv = (((node.attrs as any).keyvalue || []) as Array<[string, string]>);
                const currentKVTitle = kv.find(([k]) => k === 'title');
                const currentAttrTitle = (node.attrs as any).title || '';
                if (currentKVTitle && currentKVTitle[1] !== currentAttrTitle) {
                  const newKV = kv.filter(([k]) => k !== 'title');
                  const newAttrs = { ...(node.attrs as any), title: currentKVTitle[1], keyvalue: newKV };
                  tr = (tr || newState.tr).setNodeMarkup(pos, node.type, newAttrs);
                }
              }
              return true;
            });
            return tr || undefined;
          }
        }),
        */
      ];
    },
  };
};

export default extension;
