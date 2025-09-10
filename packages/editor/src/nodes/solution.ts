/*
 * solution.ts
 */

import { Node as ProsemirrorNode, DOMOutputSpec, Schema } from 'prosemirror-model';
import { Extension, ExtensionContext } from '../api/extension';
import { EditorState, Transaction, TextSelection, Plugin, NodeSelection } from 'prosemirror-state';
import { EditorView, NodeView } from 'prosemirror-view';
import { ProsemirrorCommand } from '../api/command';
import { OmniInsertGroup } from '../api/omni_insert';
import { PandocOutput, PandocToken, PandocTokenType } from '../api/pandoc';
import { pandocAttrReadAST, pandocAttrSpec, pandocAttrToDomAttr, pandocAttrParseDom } from '../api/pandoc_attr';

import './solution-styles.css';

function isPart(node: ProsemirrorNode, schema: Schema) {
  return node.type === (schema.nodes as any).part;
}

function findPartDepth(state: EditorState, schema: Schema): number | null {
  const { $from } = state.selection;
  for (let d = $from.depth; d >= 1; d--) {
    if (isPart($from.node(d), schema)) return d;
  }
  return null;
}

function isSolution(node: ProsemirrorNode, schema: Schema) {
  return node.type === (schema.nodes as any).solution;
}

function findSolutionDepth(state: EditorState, schema: Schema): number | null {
  const { $from } = state.selection;
  for (let d = $from.depth; d >= 1; d--) {
    if (isSolution($from.node(d), schema)) return d;
  }
  return null;
}

//

const extension = (_context: ExtensionContext): Extension => {
  return {
    nodes: [
      {
        name: 'solution',
        spec: {
          attrs: {
            ...pandocAttrSpec,
            space: { default: '' },
          },
          group: 'block',
          content: 'block*',
          isolating: true,
          defining: true,
          allowGapCursor: true,
          parseDOM: [
            {
              tag: 'div.solution',
              getAttrs(dom: Node | string) {
                const el = dom as Element;
                const base = pandocAttrParseDom(el, { class: 'solution' }, true);
                return { ...base, space: el.getAttribute('data-space') || '' };
              },
            },
          ],
          toDOM(node: ProsemirrorNode): DOMOutputSpec {
            const domAttr = pandocAttrToDomAttr({
              ...node.attrs, classes: [
                ...(((node.attrs as any).classes || []) as string[]).filter((c: string) => c !== 'solution'),
                'solution',
              ]
            });
            const headerSpace = ((node.attrs as any).space as string) || '';
            (domAttr as any)['data-space'] = headerSpace;
            return ['div', domAttr as any,
              ['div', { class: 'solution-header' }, ['span', { class: 'solution-label' }], ['span', { class: 'solution-space' }, headerSpace]],
              ['div', { class: 'solution-content' }, 0]
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
                  return Array.isArray(attr.classes) && attr.classes.includes('solution');
                } catch {
                  return false;
                }
              },
              block: 'solution',
              getAttrs: (tok: PandocToken) => {
                const attr = pandocAttrReadAST(tok, 0);
                const space = (attr.keyvalue || []).find(([k]: [string, string]) => k === 'space')?.[1] || '';
                return { ...attr, space } as { [key: string]: unknown };
              },
              getChildren: (tok: PandocToken) => {
                const children = (tok.c[1] as PandocToken[]) || [];
                if (children.length === 0) {
                  return [{ t: 'Para', c: [] } as unknown as PandocToken];
                }
                return children;
              },
            },
          ],
          writer: (output: PandocOutput, node) => {
            output.writeToken(PandocTokenType.Div, () => {
              const existingClasses = ((node.attrs as any).classes || []) as string[];
              const classes = ['solution', ...existingClasses.filter(c => c !== 'solution')];
              const space = (node.attrs as any).space || '';
              const existingKv = (((node.attrs as any).keyvalue || []) as Array<[string, string]>).filter(([k]) => k !== 'space');
              const keyvalue: Array<[string, string]> = [];
              if (space) keyvalue.push(['space', space]);
              keyvalue.push(...existingKv);
              output.writeAttr((node.attrs as any).id, classes, keyvalue as unknown as [[string, string]]);
              output.writeArray(() => {
                output.writeNodes(node);
              });
            });
          },
        },
      },
    ],

    commands: (schema: Schema) => {
      const insertSolution = new ProsemirrorCommand(
        'SolutionInsert' as any,
        [],
        (state: EditorState, dispatch?: (tr: Transaction) => void) => {
          const typeSolution = (schema.nodes as any).solution;
          const typePart = (schema.nodes as any).part;
          if (!typeSolution || !typePart) return false;
          const depth = findPartDepth(state, schema);
          if (depth == null) return false;
          // disallow inserting a solution when already inside a solution
          if (findSolutionDepth(state, schema) != null) return false;
          if (!dispatch) return true;
          const paraType = (schema.nodes as any).paragraph;
          const inner = paraType?.createAndFill();
          const solution = typeSolution.createAndFill({}, inner ? [inner] : undefined);
          if (!solution) return false;
          const insertPos = state.selection.from;
          let tr = state.tr.replaceSelectionWith(solution, false);
          tr = tr.setSelection(TextSelection.create(tr.doc, insertPos + 1)).scrollIntoView();
          dispatch(tr);
          return true;
        },
        {
          name: 'Solution',
          description: 'Insert a Solution block',
          group: OmniInsertGroup.Blocks,
          image: () => '',
        }
      );

      return [insertSolution];
    },

    plugins: (_schema: Schema) => {
      class SolutionNodeView implements NodeView {
        public dom: HTMLElement;
        public contentDOM: HTMLElement;
        private readonly view: EditorView;
        private readonly getPos: () => number;
        private spaceInput: HTMLInputElement;
        private updating = false;

        constructor(node: ProsemirrorNode, view: EditorView, getPos: boolean | (() => number)) {
          this.view = view;
          this.getPos = getPos as () => number;

          const dom = document.createElement('div');
          dom.classList.add('solution');
          dom.draggable = true;

          const header = document.createElement('div');
          header.classList.add('solution-header');
          header.setAttribute('contenteditable', 'false');

          const label = document.createElement('span');
          label.classList.add('solution-label');
          header.appendChild(label);

          const spaceInput = document.createElement('input');
          spaceInput.classList.add('solution-space');
          spaceInput.type = 'text';
          spaceInput.value = String((node.attrs as any).space || '');
          spaceInput.placeholder = 'Space';
          header.appendChild(spaceInput);

          const content = document.createElement('div');
          content.classList.add('solution-content');

          dom.appendChild(header);
          dom.appendChild(content);

          // initialize collapsed class from attrs.classes
          const hasCollapsedClass = (((node.attrs as any).classes || []) as string[]).includes('collapsed');
          if (hasCollapsedClass) dom.classList.add('collapsed');

          // toggle persisted 'collapsed' class on click of label
          label.title = 'Click to fold/unfold';
          label.setAttribute('role', 'button');
          label.setAttribute('tabindex', '0');
          const toggle = () => {
            const pos = this.getPos();
            if (typeof pos !== 'number') return;
            const nodeNow = this.view.state.doc.nodeAt(pos);
            if (!nodeNow) return;
            const classes = new Set<string>((((nodeNow.attrs as any).classes || []) as string[]));
            if (classes.has('collapsed')) {
              classes.delete('collapsed');
            } else {
              classes.add('collapsed');
            }
            const attrs = { ...(nodeNow.attrs as any), classes: Array.from(classes) } as any;
            const tr = this.view.state.tr.setNodeMarkup(pos, nodeNow.type, attrs);
            this.view.dispatch(tr);
          };
          label.addEventListener('click', () => { toggle(); });
          label.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              toggle();
            }
          });

          const commit = () => {
            if (this.updating) return;
            const pos = this.getPos();
            if (typeof pos !== 'number') return;
            const nodeNow = this.view.state.doc.nodeAt(pos);
            if (!nodeNow) return;
            const currentSpace = String(((nodeNow.attrs as any).space || ''));
            const nextSpace = spaceInput.value;
            if (currentSpace === nextSpace) return;
            const attrs = { ...(nodeNow.attrs as any), space: nextSpace } as any;
            const tr = this.view.state.tr.setNodeMarkup(pos, nodeNow.type, attrs);
            this.view.dispatch(tr);
          };

          spaceInput.addEventListener('input', commit);

          header.addEventListener('mousedown', (e) => {
            const el = e.target as HTMLElement | null;
            if (el && (el === spaceInput || (el.closest && el.closest('input')))) return;
            e.preventDefault();
            const pos = this.getPos();
            if (typeof pos !== 'number') return;
            const tr = this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, pos));
            this.view.dispatch(tr);
          });

          header.addEventListener('dragstart', (e: DragEvent) => {
            if (!e.dataTransfer) return;
            const dragImg = dom.cloneNode(true) as HTMLElement;
            dragImg.style.pointerEvents = 'none';
            dragImg.style.opacity = '0.95';
            dragImg.style.position = 'absolute';
            dragImg.style.left = '-99999px';
            document.body.appendChild(dragImg);
            e.dataTransfer.setDragImage(dragImg, 16, 16);
            setTimeout(() => { try { document.body.removeChild(dragImg); } catch { } }, 0);
          });

          // If already selected, prevent text selection on content mousedown so drag moves the whole node
          dom.addEventListener('mousedown', (e) => {
            const el = e.target as HTMLElement | null;
            if (el && (el.closest && el.closest('input'))) return;
            const pos = this.getPos();
            if (typeof pos !== 'number') return;
            const sel = this.view.state.selection;
            if (sel instanceof NodeSelection && sel.from === pos) {
              e.preventDefault();
            }
          });

          this.dom = dom;
          this.contentDOM = content;
          this.spaceInput = spaceInput;
        }

        update(node: ProsemirrorNode) {
          if ((node.type as any).name !== 'solution') return false;
          this.updating = true;
          try {
            const space = String(((node.attrs as any).space || ''));
            if (this.spaceInput.value !== space) this.spaceInput.value = space;
            const collapsed = (((node.attrs as any).classes || []) as string[]).includes('collapsed');
            if (collapsed) this.dom.classList.add('collapsed'); else this.dom.classList.remove('collapsed');
          } finally {
            this.updating = false;
          }
          return true;
        }

        ignoreMutation(mutation: MutationRecord | { type: 'selection'; target: Element }) {
          const target = (mutation as MutationRecord).target as Node | undefined;
          if (target instanceof Element) {
            if (target === this.spaceInput || target.closest('.solution-header')) return true;
          }
          return false;
        }

        stopEvent(event: Event) {
          const target = event.target as HTMLElement | null;
          if (!target) return false;
          if (target === this.spaceInput || (target.closest && target.closest('.solution-header'))) {
            return true;
          }
          return false;
        }

        selectNode() {
          this.dom.classList.add('node-selected');
          if (this.spaceInput) this.spaceInput.blur();
        }

        deselectNode() {
          this.dom.classList.remove('node-selected');
        }
      }

      return [
        new Plugin({
          props: {
            nodeViews: {
              solution(node: ProsemirrorNode, view: EditorView, getPos: boolean | (() => number)) {
                return new SolutionNodeView(node, view, getPos);
              },
            },
          },
        }),
        new Plugin({
          props: {
            handleKeyDown(view, event) {
              const state = view.state;
              if (!(state.selection instanceof TextSelection) || !state.selection.empty) return false;
              const depth = findSolutionDepth(state, _schema);
              if (depth == null) return false;
              const $from = state.selection.$from;
              const container = $from.node(depth);
              if (container.childCount !== 1) return false;
              if (event.key === 'Backspace' && $from.parentOffset === 0) return true;
              if (event.key === 'Delete') {
                const atEnd = $from.parentOffset === $from.parent.content.size;
                if (atEnd) return true;
              }
              return false;
            },
          },
        }),
      ];
    },
  };
};

export default extension;
