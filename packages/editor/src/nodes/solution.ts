/*
 * solution.ts
 */

import { Node as ProsemirrorNode, DOMOutputSpec, Schema } from 'prosemirror-model';
import { Extension, ExtensionContext } from '../api/extension';
import { EditorState, Transaction, TextSelection } from 'prosemirror-state';
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

function solutionHeader(): DOMOutputSpec {
  return ['div', { class: 'solution-header' }, ['span', { class: 'solution-label' }]];
}

const extension = (_context: ExtensionContext): Extension => {
  return {
    nodes: [
      {
        name: 'solution',
        spec: {
          attrs: {
            ...pandocAttrSpec,
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
                return { ...base };
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
            return ['div', domAttr as any, solutionHeader(), ['div', { class: 'solution-content' }, 0]];
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
                return { ...attr } as { [key: string]: unknown };
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
              const keyvalue = (((node.attrs as any).keyvalue || []) as Array<[string, string]>);
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
  };
};

export default extension;
