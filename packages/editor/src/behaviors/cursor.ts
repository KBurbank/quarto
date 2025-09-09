/*
 * cursor.ts
 *
 * Copyright (C) 2022 by Posit Software, PBC
 *
 * Unless you have received this program directly from Posit Software pursuant
 * to the terms of a commercial license agreement with Posit Software, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */

import { PluginKey, Plugin, EditorState, Transaction, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { ResolvedPos, Node as ProsemirrorNode } from 'prosemirror-model';

import { dropCursor } from 'prosemirror-dropcursor';
import { gapCursor, GapCursor } from 'prosemirror-gapcursor';
import 'prosemirror-gapcursor/style/gapcursor.css';

import { findParentNodeOfTypeClosestToPos, findParentNodeOfType, findParentNode } from 'prosemirror-utils';

import { Extension } from '../api/extension';
import { BaseKey } from '../api/basekeys';
import { isList } from '../api/list';

import './cursor.css';
import { verticalArrowCanAdvanceWithinTextBlock } from '../api/cursor';


const extension: Extension = {

  baseKeys: () => {
    return [
      { key: BaseKey.ArrowLeft, command: gapArrowHandler('left') },
      { key: BaseKey.ArrowUp, command: gapArrowHandler('up') },
      { key: BaseKey.Enter, command: enterAtGapCursor() }
    ];
  },

  plugins: () => {
    return [
      gapCursor(),
      dropCursor(),
      new Plugin({
        key: new PluginKey('div-gap-cursor'),
        props: {
          handleDOMEvents: {
            click: gapClickHandler,
          },
        },
      })];
  },
};

function gapArrowHandler(dir: 'up' | 'left') {
  return (state: EditorState, dispatch?: (tr: Transaction) => void, view?: EditorView) => {


    // function to create a gap cursor
    const createGapCursor = ($pos: ResolvedPos) => {
      if (dispatch) {
        const cursor = new GapCursor($pos);
        const tr = state.tr;
        tr.setSelection(cursor);
        dispatch(tr);
      }
      return true;
    };

    if (state.selection.empty && view && view.endOfTextblock(dir)) {

      // get the selection
      const $head = state.selection.$head;

      // if we are in a block that handles up/down (e.g. display math)
      // then we don't want to make a gap cursor
      if (dir === 'up' && verticalArrowCanAdvanceWithinTextBlock(state.selection, dir)) {
        return false;
      }

      // check if we are in a div
      if (state.schema.nodes.div) {
        const div = findParentNodeOfType(state.schema.nodes.div)(state.selection);

        // if we are at the very top of a div then create a gap cursor
        if (div) {

          const $divPos = state.doc.resolve(div.pos);
          if ($head.index($head.depth - 1) === 0 && !(state.selection instanceof GapCursor)) {

            // if we are in a list item the calculations about view.endOfTextblock will be off
            if (findParentNode(isList)(state.selection)) {
              return false;
            }

            return createGapCursor(state.doc.resolve($divPos.pos + 1));
            // if we are between divs then create a gap cursor between them
          } else if ($divPos.nodeBefore?.type === state.schema.nodes.div) {
            return createGapCursor(state.doc.resolve($divPos.pos));
          }
        }
      }


      // if we are at the top of the document then create a gap cursor
      if (!$head.nodeBefore && ($head.pos <= 2)) {
        return createGapCursor(state.doc.resolve($head.pos - 1));
      }

      return false;

    } else {
      return false;
    }


  };
}

function enterAtGapCursor() {
  return (state: EditorState, dispatch?: (tr: Transaction) => void, view?: EditorView) => {
    if (!(state.selection instanceof GapCursor)) {
      return false;
    }
    const schema = state.schema;
    const paragraph = schema.nodes.paragraph;
    if (!paragraph) {
      return true; // swallow
    }
    if (dispatch) {
      const pos = (state.selection as any).from as number;
      let tr = state.tr.insert(pos, paragraph.create());
      tr = tr.setSelection(TextSelection.create(tr.doc, pos + 1)).scrollIntoView();
      dispatch(tr);
      if (view) view.focus();
    }
    return true;
  };
}

function gapClickHandler(view: EditorView, event: Event): boolean {

  const schema = view.state.schema;
  const mouseEvent = event as MouseEvent;
  const clickPos = view.posAtCoords({ left: mouseEvent.clientX, top: mouseEvent.clientY });

  if (clickPos) {

    // resolve click pos
    const $clickPos = view.state.doc.resolve(clickPos.pos);

    // create a gap cursor at the click position
    const createGapCursor = () => {
      // focus the view
      view.focus();

      // create the gap cursor
      const tr = view.state.tr;
      const cursor = new GapCursor($clickPos);
      tr.setSelection(cursor);
      view.dispatch(tr);

      // prevent default event handling
      event.preventDefault();
      event.stopImmediatePropagation();
      return true;
    };

    // handle clicks at the top of divs
    if (schema.nodes.div) {
      const div = findParentNodeOfTypeClosestToPos(
        view.state.doc.resolve(clickPos.pos), schema.nodes.div
      );
      if (div && div.pos === clickPos.inside) {
        const divNode = view.nodeDOM(div.start);
        if (divNode instanceof HTMLElement) {
          if (Math.abs(mouseEvent.clientX - divNode.getBoundingClientRect().left) < 150) {
            return createGapCursor();
          }
        }
      }
    }

    // exam nodes left-gutter and bottom-edge handling
    const tryEdgeGapFor = (type: any): boolean => {
      const nodeWithPos = findParentNodeOfTypeClosestToPos(view.state.doc.resolve(clickPos.pos), type);
      if (!nodeWithPos) return false;
      if (nodeWithPos.pos !== clickPos.inside) return false;
      const el = view.nodeDOM(nodeWithPos.start);
      if (!(el instanceof HTMLElement)) return false;
      const rect = el.getBoundingClientRect();
      const x = mouseEvent.clientX;
      const y = mouseEvent.clientY;
      const nearLeft = Math.abs(x - rect.left) < 150;
      const nearTop = Math.abs(y - rect.top) < 8;
      const nearBottom = Math.abs(y - rect.bottom) < 8;
      if (nearLeft || nearTop) {
        return createGapCursor();
      } else if (nearBottom) {
        // attempt gap after node
        const afterPos = nodeWithPos.pos + nodeWithPos.node.nodeSize;
        const $after = view.state.doc.resolve(afterPos);
        const tr = view.state.tr;
        tr.setSelection(new GapCursor($after));
        view.dispatch(tr);
        view.focus();
        return true;
      }
      return false;
    };
    const part = (schema.nodes as any).part;
    const question = (schema.nodes as any).question;
    const subpart = (schema.nodes as any).subpart;
    if (part && tryEdgeGapFor(part)) return true;
    if (question && tryEdgeGapFor(question)) return true;
    if (subpart && tryEdgeGapFor(subpart)) return true;

    // handle clicks between certain block types that don't have a natural text cursor
    // for inserting additioanl content
    const blockRequiresGap = (node: ProsemirrorNode | null | undefined) => {
      if (node) {
        return node.type === schema.nodes.div ||
          node.type === schema.nodes.figure ||
          node.type === schema.nodes.table ||
          node.type === schema.nodes.horizontal_rule ||
          node.type === schema.nodes.code_block ||
          node.type === schema.nodes.raw_block ||
          node.type === schema.nodes.rmd_chunk ||
          node.type === schema.nodes.html_preserve ||
          node.type === schema.nodes.shortcode_block ||
          node.type === schema.nodes.yaml_metadata ||
          // exam nodes: allow gap cursor between them
          node.type === (schema.nodes as any).part ||
          node.type === (schema.nodes as any).question ||
          node.type === (schema.nodes as any).subpart;
      } else {
        return false;
      }
    };
    if (!clickPos.inside) {
      if (blockRequiresGap($clickPos.nodeBefore) && blockRequiresGap($clickPos.nodeAfter)) {
        // Prefer inserting an empty paragraph between blocks if allowed
        const paragraph = schema.nodes.paragraph;
        if (paragraph && $clickPos.parent.canReplaceWith($clickPos.index(), $clickPos.index(), paragraph)) {
          let tr = view.state.tr;
          tr = tr.insert($clickPos.pos, paragraph.create());
          tr = tr.setSelection(TextSelection.create(tr.doc, $clickPos.pos + 1));
          view.dispatch(tr);
          view.focus();
          return true;
        }
        // Fallback to gap cursor if paragraph insertion isn't valid here
        return createGapCursor();
      }
    }

    // handle clicks above body
    // Take this out for now b/c it was interfering with other mouse
    // gestures (e.g. clicking on attr editor). keyboard gestures still
    // work to get to the top of the body
    /*
    if ($clickPos.parent.type === schema.nodes.body &&
        $clickPos.start() === $clickPos.pos) {

      return createGapCursor();

    }
    */
  }

  return false;
}

export default extension;
