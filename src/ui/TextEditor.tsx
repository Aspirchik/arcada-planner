/** In-place editor for text notes: a textarea laid over the canvas at the note's position */
import { useEffect, useRef, useState } from 'react';
import { useStore, DEFAULT_TEXT_SIZE } from '../store';
import { usePalette } from '../theme';
import { TEXT_FONT, TEXT_LINE_HEIGHT, measureNote } from './AnnotationsLayer';

export function TextEditor() {
  const edit       = useStore(s => s.textEdit);
  const floor      = useStore(s => s.floors[s.fi]);
  const stageX     = useStore(s => s.stageX);
  const stageY     = useStore(s => s.stageY);
  const stageScale = useStore(s => s.stageScale);
  const palette    = usePalette();
  const note = edit?.id != null ? floor.texts.find(n => n.id === edit.id) ?? null : null;

  const [draft, setDraft] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);

  useEffect(() => {
    if (!edit) return;
    done.current = false;
    setDraft(note?.text ?? '');
    requestAnimationFrame(() => { ref.current?.focus(); ref.current?.select(); });
  // Only when a new edit session starts
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edit]);

  if (!edit) return null;

  const x = note?.x ?? edit.x;
  const y = note?.y ?? edit.y;
  const size = note?.size ?? DEFAULT_TEXT_SIZE;
  const bold = note?.bold ?? false;
  const rot = note?.rot ?? 0;
  const m = measureNote({ text: draft || ' ', size, bold });

  function finish(save: boolean) {
    if (done.current) return;
    done.current = true;
    const st = useStore.getState();
    const text = draft.replace(/\s+$/, '');
    if (save) {
      if (note) {
        if (!text.trim()) st.deleteText(note.id);
        else if (text !== note.text) st.updateText(note.id, { text });
      } else if (text.trim()) {
        const id = st.addText(x, y, text);
        st.select(id);
      }
    }
    st.setTextEdit(null);
  }

  return (
    <textarea
      ref={ref}
      className="text-editor"
      value={draft}
      spellCheck={false}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finish(true); }
        if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      }}
      style={{
        left: stageX + x * stageScale,
        top: stageY + y * stageScale,
        width: (m.w + size) * stageScale + 8,
        height: m.h * stageScale + 4,
        fontSize: size * stageScale,
        lineHeight: TEXT_LINE_HEIGHT,
        fontFamily: TEXT_FONT,
        fontWeight: bold ? 'bold' : 'normal',
        color: note?.color ?? palette.text,
        transform: `rotate(${rot}deg)`,
      }}
    />
  );
}
