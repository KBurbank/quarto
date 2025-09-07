/*
 * exam.ts
 */

import { Node as ProsemirrorNode, DOMOutputSpec } from 'prosemirror-model';
import { Extension, ExtensionContext } from '../../api/extension';
import { AppendTransactionHandler } from '../../api/transaction';
import { PandocOutput, PandocTokenType, PandocToken } from '../../api/pandoc';
import { pandocAttrSpec, pandocAttrToDomAttr, pandocAttrParseDom, pandocAttrReadAST } from '../../api/pandoc_attr';

import './exam-styles.css';

const PART_ATTR = 0;
const PART_CHILDREN = 1;
const QUESTION_ATTR = 0;
const QUESTION_CHILDREN = 1;
const SUBPART_ATTR = 0;
const SUBPART_CHILDREN = 1;

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
          group: 'block list_item_block',
          defining: true,
          parseDOM: [
            {
              tag: 'div[class~="part"]',
              getAttrs(dom: Node | string) {
                const el = dom as Element;
                const base = pandocAttrParseDom(el, {});
                return {
                  ...base,
                  title: el.getAttribute('data-title') || 'Part',
                };
              },
            },
          ],
          toDOM(node: ProsemirrorNode): DOMOutputSpec {
            const attrs = {
              ...pandocAttrToDomAttr({ ...node.attrs, classes: [...node.attrs.classes, 'part'] }),
              'data-title': node.attrs.title,
            } as { [key: string]: string };
            return [
              'div',
              attrs,
              ['div', { class: 'part-header' }, node.attrs.title || 'Part'],
              ['div', { class: 'part-content' }, 0],
            ];
          },
        },
        pandoc: {
          readers: [
            {
              token: PandocTokenType.Div,
              match: (tok: PandocToken) => {
                try {
                  const attr = pandocAttrReadAST(tok, PART_ATTR);
                  return (attr.classes || []).includes('part');
                } catch {
                  return false;
                }
              },
              block: 'part',
              getAttrs: (tok: PandocToken) => {
                const attr = pandocAttrReadAST(tok, PART_ATTR);
                const title = (attr.keyvalue || []).find(([k]) => k === 'title')?.[1] || 'Part';
                return { ...attr, title };
              },
              getChildren: (tok: PandocToken) => tok.c[PART_CHILDREN],
            },
          ],
          writer: (output: PandocOutput, node: ProsemirrorNode) => {
            output.writeToken(PandocTokenType.Div, () => {
              const classes = [...node.attrs.classes, 'part'];
              const keyvalue = (node.attrs.keyvalue || []) as [[string, string]] | undefined;
              const kv = (keyvalue ? [...keyvalue] : []) as [string, string][];
              const title = node.attrs.title as string | undefined;
              if (title) {
                const existingIdx = kv.findIndex(([k]) => k === 'title');
                if (existingIdx >= 0) kv.splice(existingIdx, 1);
                kv.push(['title', title]);
              }
              // pandoc attr: id, classes, keyvalue
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (output as any).writeAttr(node.attrs.id, classes, kv as unknown as [[string, string]]);
              output.writeArray(() => {
                output.writeNodes(node);
              });
            });
          },
        },
      },
      {
        name: 'question',
        spec: {
          attrs: {
            ...pandocAttrSpec,
            title: { default: 'Question' },
          },
          content: 'block+',
          group: 'block list_item_block',
          defining: true,
          parseDOM: [
            {
              tag: 'div[class~="question"]',
              getAttrs(dom: Node | string) {
                const el = dom as Element;
                const base = pandocAttrParseDom(el, {});
                return {
                  ...base,
                  title: el.getAttribute('data-title') || 'Question',
                };
              },
            },
          ],
          toDOM(node: ProsemirrorNode): DOMOutputSpec {
            const attrs = {
              ...pandocAttrToDomAttr({ ...node.attrs, classes: [...node.attrs.classes, 'question'] }),
              'data-title': node.attrs.title,
            } as { [key: string]: string };
            return [
              'div',
              attrs,
              ['div', { class: 'question-header' }, node.attrs.title || 'Question'],
              ['div', { class: 'question-content' }, 0],
            ];
          },
        },
        pandoc: {
          readers: [
            {
              token: PandocTokenType.Div,
              match: (tok: PandocToken) => {
                try {
                  const attr = pandocAttrReadAST(tok, QUESTION_ATTR);
                  return (attr.classes || []).includes('question');
                } catch {
                  return false;
                }
              },
              block: 'question',
              getAttrs: (tok: PandocToken) => {
                const attr = pandocAttrReadAST(tok, QUESTION_ATTR);
                const title = (attr.keyvalue || []).find(([k]) => k === 'title')?.[1] || 'Question';
                return { ...attr, title };
              },
              getChildren: (tok: PandocToken) => tok.c[QUESTION_CHILDREN],
            },
          ],
          writer: (output: PandocOutput, node: ProsemirrorNode) => {
            output.writeToken(PandocTokenType.Div, () => {
              const classes = [...node.attrs.classes, 'question'];
              const keyvalue = (node.attrs.keyvalue || []) as [[string, string]] | undefined;
              const kv = (keyvalue ? [...keyvalue] : []) as [string, string][];
              const title = node.attrs.title as string | undefined;
              if (title) {
                const existingIdx = kv.findIndex(([k]) => k === 'title');
                if (existingIdx >= 0) kv.splice(existingIdx, 1);
                kv.push(['title', title]);
              }
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (output as any).writeAttr(node.attrs.id, classes, kv as unknown as [[string, string]]);
              output.writeArray(() => {
                output.writeNodes(node);
              });
            });
          },
        },
      },
      {
        name: 'subpart',
        spec: {
          attrs: {
            ...pandocAttrSpec,
            title: { default: 'Subpart' },
          },
          content: 'block+',
          group: 'block list_item_block',
          defining: true,
          parseDOM: [
            {
              tag: 'div[class~="subpart"]',
              getAttrs(dom: Node | string) {
                const el = dom as Element;
                const base = pandocAttrParseDom(el, {});
                return {
                  ...base,
                  title: el.getAttribute('data-title') || 'Subpart',
                };
              },
            },
          ],
          toDOM(node: ProsemirrorNode): DOMOutputSpec {
            const attrs = {
              ...pandocAttrToDomAttr({ ...node.attrs, classes: [...node.attrs.classes, 'subpart'] }),
              'data-title': node.attrs.title,
            } as { [key: string]: string };
            return [
              'div',
              attrs,
              ['div', { class: 'subpart-header' }, node.attrs.title || 'Subpart'],
              ['div', { class: 'subpart-content' }, 0],
            ];
          },
        },
        pandoc: {
          readers: [
            {
              token: PandocTokenType.Div,
              match: (tok: PandocToken) => {
                try {
                  const attr = pandocAttrReadAST(tok, SUBPART_ATTR);
                  return (attr.classes || []).includes('subpart');
                } catch {
                  return false;
                }
              },
              block: 'subpart',
              getAttrs: (tok: PandocToken) => {
                const attr = pandocAttrReadAST(tok, SUBPART_ATTR);
                const title = (attr.keyvalue || []).find(([k]) => k === 'title')?.[1] || 'Subpart';
                return { ...attr, title };
              },
              getChildren: (tok: PandocToken) => tok.c[SUBPART_CHILDREN],
            },
          ],
          writer: (output: PandocOutput, node: ProsemirrorNode) => {
            output.writeToken(PandocTokenType.Div, () => {
              const classes = [...node.attrs.classes, 'subpart'];
              const keyvalue = (node.attrs.keyvalue || []) as [[string, string]] | undefined;
              const kv = (keyvalue ? [...keyvalue] : []) as [string, string][];
              const title = node.attrs.title as string | undefined;
              if (title) {
                const existingIdx = kv.findIndex(([k]) => k === 'title');
                if (existingIdx >= 0) kv.splice(existingIdx, 1);
                kv.push(['title', title]);
              }
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

    appendTransaction: () => {
      const handler: AppendTransactionHandler = {
        name: 'exam-convert-divs',
        append: (tr, _transactions, _oldState, newState) => {
          const schema = newState.schema;
          const convertAt: Array<{ pos: number; typeName: 'part' | 'question' | 'subpart' }> = [];
          newState.doc.descendants((node, pos) => {
            if (node.type === schema.nodes.div) {
              const classes: string[] = (node.attrs.classes || []) as string[];
              if (classes.includes('part')) {
                convertAt.push({ pos, typeName: 'part' });
              } else if (classes.includes('question')) {
                convertAt.push({ pos, typeName: 'question' });
              } else if (classes.includes('subpart')) {
                convertAt.push({ pos, typeName: 'subpart' });
              }
            }
            return true;
          });
          // apply in reverse order to keep positions stable
          for (let i = convertAt.length - 1; i >= 0; i--) {
            const { pos, typeName } = convertAt[i];
            const node = tr.doc.nodeAt(pos) || newState.doc.nodeAt(pos);
            if (!node) continue;
            if (node.type !== schema.nodes.div) continue;
            const targetType = schema.nodes[typeName];
            if (!targetType) continue;
            // derive title from keyvalue if present
            const keyvalue = (node.attrs.keyvalue || []) as [string, string][];
            const titleKV = keyvalue.find(([k]) => k === 'title');
            const title = titleKV ? titleKV[1] : (typeName === 'part' ? 'Part' : typeName === 'question' ? 'Question' : 'Subpart');
            const attrs = { ...node.attrs, title } as { [key: string]: unknown };
            tr.setNodeMarkup(pos, targetType, attrs);
          }
        }
      };
      return [handler];
    },
  };
};

export default extension;
